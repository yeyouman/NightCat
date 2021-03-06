import { User } from '../proxy'
import md5 from 'md5'
import validator from 'validator'
import eventproxy from 'eventproxy'
import mail from '../common/mail'
import utils from '../common/sign'
import logger from '../common/logger'
import config from '../config'

export default {
	/*  注册账号  */
	signup: async(req, res, next) => {
		let account = req.body.account
		let password = req.body.password
		let repassword = req.body.repassword
		let email = req.body.email

		let ep = new eventproxy()
		ep.fail(next)
		ep.on('signup_err', (msg, status = 403) => {
			res.status(status)
			res.json({
				success: false,
				message: msg
			})
		})

		if ([account, password, repassword, email].some((v) => v === '')) {
			return ep.emit('signup_err', '信息不完整')
		}
		if (!validator.isByteLength(account, { min: 6, max: 20 })) {
			return ep.emit('signup_err', '账号至少需要6个字符')
		}
		if (!validator.isByteLength(password, { min: 6 })) {
			return ep.emit('signup_err', '密码至少需要6个字符')
		}
		if (!validator.isAlphanumeric(account)) {
			return ep.emit('signup_err', '账号只能包含字母和数字')
		}
		if (!validator.isEmail(email)) {
			return ep.emit('signup_err', '邮箱不合法')
		}
		if (password !== repassword) {
			return ep.emit('signup_err', '两次密码输入不一致')
		}
		if (await User.getUserByAccount(account)) {
			return ep.emit('signup_err', '账号已存在')
		}
		if (await User.getUserByEmail(email)) {
			return ep.emit('signup_err', '邮箱已被注册')
		}

		let md5pass = md5(md5(password))
		let userInfo = {
			account: account,
			password: md5pass,
			email: email
		}

		await User.newAndSave(userInfo)
			.then(() => {
				mail.sendActiveMail(email, md5(email + md5pass + config.session_secret), account)
				return res.json({
					success: true,
					message: '欢迎加入 ' + config.name + '！我们已给您的注册邮箱发送了一封邮件，请点击里面的链接来激活您的帐号。',
				})
			})
			.catch((err) => {
				next(err)
			})
	},
	/*  登录账号  */
	signin: async(req, res, next) => {
		let account = req.body.account
		let password = req.body.password

		var ep = new eventproxy()
		ep.fail(next)
		ep.on('login_err', (msg, status = 403) => {
			res.status(status)
			res.json({
				success: false,
				message: msg
			})
		})

		if (!account || account === '') {
			return ep.emit('login_err', '账号不能为空')
		}
		if (!password || password === '') {
			return ep.emit('login_err', '密码不能为空')
		}

		let userInfo = {
			account: account,
			password: md5(md5(password))
		}

		await User.getUserByAccount(account)
			.then((user) => {
				if (!user) {
					return ep.emit('login_err', '账号不存在')
				}

				if (user.password !== userInfo.password) {
					return ep.emit('login_err', '密码错误')
				}
				else if (!user.active) {
					// 重新发送激活邮件
					mail.sendActiveMail(user.email, md5(user.email + user.password + config.session_secret), account)
					res.status(403);
					return ep.emit('login_err', `此帐号还没有被激活，激活链接已发送到 ${user.email} 邮箱，请查收。`)
				}
				else {
					let token = utils.signToken(user.account)
					req.session.token = token
					req.session.is_admin = user.admin
					return res.json({
						success: true,
						message: '登录成功',
						data: {
							is_admin: user.admin,
							userInfo: {
								account: user.account,
								email: user.email,
								name: user.name,
								location: user.location,
								github: user.github,
								website: user.website,
								profile: user.profile,
								gameData: user.gameData,
								avatar: user.avatar
							},
							accessToken: user.accessToken,
							token: token
						}
					})
				}
			})
			.catch((err) => next(err))
	},
	/*  退出登录  */
	signout: async(req, res, next) => {
		req.session.destroy()
		res.json({
			success: true,
			message: '退出登录成功'
		})
	},
	/*  认证是否登录  */
	verify: async(req, res, next) => {
		let token = req.session.token
		await utils.verifyToken(token)
		.then((account) => User.getUserByAccount(account))
		.then((user) => {
			req.session.token = token
			res.json({
				success: true,
				message: '登录成功',
				data: {
					userInfo: {
						account: user.account,
						email: user.email,
						name: user.name,
						location: user.location,
						github: user.github,
						website: user.website,
						profile: user.profile,
						gameData: user.gameData,
						avatar: user.avatar
					},
					accessToken: user.accessToken,
					token: token
				}
			})
		})
		.catch(err => {
			res.status(403)
			res.json({
				success: false,
				message: '认证失败'
			})
		})
	},
	/*  激活账号  */
	activeAccount: async(req, res, next) => {
		let key = req.query.key
		let account = req.query.account

		var ep = new eventproxy()
		ep.fail(next)
		ep.on('active_account_result', (msg, bool) => {
			res.status(200)
			res.json({
				success: !!bool,
				message: msg
			})
		})
		User.getUserByAccount(account)
			.then((user) => {
				if (!user) {
					return ep.emit('active_account_result', '无效的账号')
				}
				if (md5(user.email + user.password + config.session_secret) !== key) {
					return ep.emit('active_account_result', '信息有误，账号无法激活')
				}
				if (user.active) {
					return ep.emit('active_account_result', '账号已被激活')
				}
				user.active = true
				user.save(err => {
					if (err) {
						return next(err)
					}
					return ep.emit('active_account_result', '激活成功!', true)
				})
			})
			.catch((err) => next(err))
	}
}