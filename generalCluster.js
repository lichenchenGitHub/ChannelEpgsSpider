/**
 * Created by lichenchen on 2016/11/18.
 */
var cluster = require("cluster");
var unirest = require('unirest');
var Promise = require("bluebird");
var kue = require("kue");
var redis = require("redis");
var url = require("url");
var jsdom = require("jsdom");
var fs = require("fs");
var jquery = fs.readFileSync('./public/javascripts/jquery-1.11.3.min.js').toString();
var numCPUs = require('os').cpus().length;
var async = require("async");

var conf = require('./conf/config');
var profile = require("./conf/rules");
var rules = profile.rules;
//var mongoose = require('./lib/mongoose');
//var Channel = require('./model/tv/channel');
//var ChannelEpg = require('./model/tv/channelepg');
//var ChannelModel = Channel.getMongoDataModel(mongoose);
//var ChannelEpgModel = ChannelEpg.getMongoDataModel(mongoose);
var ChannelPage = require("./lib/tvmaochannelPage");
var TvsouChannel = require("./lib/tvsouchannelPage");

var keystore = redis.createClient(conf.redisConf.keys.port, conf.redisConf.keys.host);
var expireDuration = profile.expire;
var delayDuration = profile.delay;
var ttlDuration = profile.ttl;
var failDuration=profile.fail;
var initDuration=profile.init;
var incativeDuration=profile.inactive;
var Hasher = require('./lib/hasher');
var dataDeal = require('./lib/dataDeal');
var poolOption = {
    maxSockets: 100
};
var queue = kue.createQueue({
    prefix: conf.name,
    redis: conf.redisConf.queue
});
var initJob = function () {
    rules.forEach(function (item, index) {
        console.log(item.baseUrl);
        var hash = Hasher.GetSHA1(item.baseUrl);
        keystore.set(hash, 1, 'EX', expireDuration, 'NX', function (err, msg) {
            if (err) {
                console.log(JSON.stringify({role: "init", err: err}));
            } else if (msg == 'OK') {
                var job = queue.create("links", {
                    site: item.site,
                    url: item.baseUrl,
                    pattern: item.pattern,
                    level: 0,
                    ras: item.ras,
                    headers: item.headers
                }).attempts(3).backoff({
                    delay: delayDuration,
                    type: 'fixed'
                }).removeOnComplete(true).ttl(ttlDuration).save(function (err) {
                    if (err) {
                        console.log(item.baseUrl + " : create job err " + err);
                    } else {
                        console.log(item.baseUrl + " : create job success as job " + job.id);
                    }
                })
            } else {
                console.log(item.baseUrl + " has in jobList");
            }

        });
    })

}
if (cluster.isMaster) {
    kue.app.listen(9004);
    queue.on('error', function (err) {
        console.error(JSON.stringify({role: 'scheduler', err: err}));
    });
    var forkWorker = function () {
        var worker = cluster.fork();
        worker.on('error', function (err) {
            console.log('worker error: ' + err);
        });
        console.log('worker ' + worker.process.pid + ' forked at: ' + new Date());
        return worker;
    };
    for (var i = 0; i < numCPUs; i++) {
        forkWorker();
    }
    initJob();
    var logStat = function () {
        queue.inactiveCount(function (err, total) {
            console.log('inactive: ' + total);
        });
    };
    var removeJob = function () {
        console.log("remove job start at " + new Date());
        kue.Job.rangeByType("links", 'failed', 0, 50, 'asc', function (err, jobs) {
            if (err) {
                console.error(err);
            } else {
                if (jobs instanceof Array && jobs.length > 0) {
                    jobs.forEach(function (job) {
                        job.remove(function () {
                            console.log('removed '+job.id + " at  " + new Date());
                        });
                    })
                } else {
                    console.log("don't have failed jobs");
                }
            }
        });
        // queue.failed(function (err, ids) {
        //     ids.forEach(function (id) {
        //         kue.Job.get(id, function (err, job) {
        //             job.remove(function () {
        //                 console.log('removed ', job.id + ":" + job.data.url + ",level:" + job.data.level);
        //             });
        //         });
        //     });
        // });

    }
    var resetInterval = null;
    resetInterval = setInterval(initJob, initDuration);
    var logInterval = null;
    logInterval = setInterval(logStat, incativeDuration);
    var removeInterval = null;
    removeInterval = setInterval(removeJob, failDuration);
    cluster.on('exit', function (worker, code, signal) {
        if (signal) {
            console.log('worker ' + worker.process.pid + ' was killed by signal: ' + signal);
        }
        else if (code !== 0) {
            console.log('worker ' + worker.process.pid + ' exited with error code: ' + code);
            forkWorker();
        }
        else {
            console.log('worker ' + worker.process.pid + ' exited success!');
        }
    });
    var quitCallback = function () {
        queue.shutdown(1000, function (err) {
            if (removeInterval) {
                clearInterval(removeInterval);
                removeInterval = null;
            }
            if (resetInterval) {
                clearInterval(resetInterval);
                resetInterval = null;
            }
            if (logInterval) {
                clearInterval(logInterval);
                logInterval = null;
            }
            for (var id in cluster.workers) {
                console.log('Closing worker id: ' + id);
                cluster.workers[id].kill('SIGTERM');
            }
            setTimeout(function () {
                process.exit(0);
            }, 3000);
        });
    }
    process.once("SIGINT", quitCallback);
    process.once("SIGTERM", quitCallback);
} else {
    queue.process("links", function (job, done) {
        if (job.data.url && job.data.ras && job.data.level >= 0 && job.data.site && job.data.pattern) {
            var ChannelParse = require("./lib/" + job.data.ras);
            var channelParser = new ChannelParse(job.data.site, job.data.url, job.data.pattern, job.data.ras, job.data.headers, job.data.level);
            channelParser.getPageInfo().then(function (array) {
                return dataDeal.enterDatabase(array)
            }).then(function (arr) {
                return dataDeal.pushQueue(arr);
            }).then(function (data) {
                return done();
            }).catch(function (err) {
                console.error(err);
                done(err);
            })
        } else {
            done("job data parameters lack");
        }
    })

}
