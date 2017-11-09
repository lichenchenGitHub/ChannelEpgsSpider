var mongoose = require('mongoose');
mongoose.Promise = require('bluebird');
var options = {
    server: {socketOptions: {keepAlive: 300000, connectTimeoutMS: 30000}},
    replset: {socketOptions: {keepAlive: 300000, connectTimeoutMS: 30000}}
}


var conf = require('../conf/config');
var connectionString = 'mongodb://' + conf.mongodb.user + ':' + conf.mongodb.passwd + '@' + conf.mongodb.host + ':' + conf.mongodb.port + '/' + conf.mongodb.db;

mongoose.connect(connectionString, options, function (err) {
});

mongoose.connection.on('open', function (ref) {
});

mongoose.connection.on('error', function (err) {
    console.error(err);
});

module.exports = mongoose;
