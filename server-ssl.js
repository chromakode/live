/**
 * Important note: this application is not suitable for benchmarks!
 */

var fs = require('fs'),
	express = require('express'),
	connect = require('connect'),
	uid = connect.utils.uid,
	io = require('socket.io');

function TokenStore(secret) {
	this.secret = secret
	this.tokens = {}
}
TokenStore.prototype = {
	generate: function(sessionID, expires) {
		var now = Date.now()
		expires = expires || 2*60*60*1000
		var token = {
			id: uid(24),
			owner: sessionID,
			expires: now + expires
		}
		this.tokens[token.id] = token
		return token.id
	},
	expire: function() {
		var now = Date.now()
		for (var token in this.tokens) {
			if (now > this.tokens[token].expires) {
				delete this.tokens[token]
			}
		}
	},
	get: function(token) {
		this.expire()
		return this.tokens[token]
	},
	remove: function(token) {
		delete this.tokens[token]
	},
	check: function(token) {
		this.expire()
		return !!this.tokens[token]
	}
}

var secret = "we'lldoitlive",
	super_secret_password = "live",
	tokens = new TokenStore(secret)

var app = express.createServer({
	key: fs.readFileSync(__dirname + '/key.pem'),
	cert: fs.readFileSync(__dirname + '/cert.pem')
})

app.use(express.static(__dirname + '/public'))
app.use(express.logger());
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.session({ secret:secret, cookie:{ secure: true }}));
app.register('.html', require('ejs'));
app.set('view options', { layout:false })
app.get('/authorize', function(req, res) {
	res.render('authorize.html', { hasSession: req.session.isPresenter });
})
app.post('/authorize', function(req, res) {
	function success() {
		res.render('success.html', {
			token: tokens.generate(req.sessionID)
		})
	}

	if (req.session.isPresenter) {
		success()
	} else if (req.body.password == super_secret_password) {
		req.session.regenerate(function() {
			req.session.isPresenter = true
			success()
		})
	} else {
		res.redirect('/authorize?retry', 303)
	}
})
app.listen(1234);

var state = {}

var io = io.listen(app, {
	resource: 'live',
	transports: ['xhr-polling', 'jsonp-polling'],
})
io.on('connection', function(client) {
	client.isPresenter = false
	client.send({ name:'slide', index:state.index });
	
	client.on('message', function(msg) {
		if (msg.name == 'authorize') {
			if (tokens.check(msg.token)) {
				client.isPresenter = true
				client.token = msg.token
			}
			client.send({ name:'authorized', success:!!client.isPresenter })
		}
		console.log(client.sessionId, client.isPresenter, msg)
		if (!client.isPresenter) { return }

		if (msg.name == 'slide') {
			state.index = msg.index
			client.broadcast(msg)
		} else if (msg.name = 'end') {
			tokens.remove(client.token)
		}
	});
	client.on('disconnect', function() {});
});
