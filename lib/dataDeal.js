/**
 * Created by lichenchen on 2016/11/18.
 */
var Promise = require("bluebird");
var kue = require("kue");
var mongoose = require('./mongoose');
var Channel = require('../model/tv/channel');
var ChannelEpg = require('../model/tv/channelepg');
var ChannelModel = Channel.getMongoDataModel(mongoose);
var ChannelEpgModel = ChannelEpg.getMongoDataModel(mongoose);
var Hasher = require('./hasher');
var duration = require("../conf/rules");
var expireDuration = duration.expire;
var delayDuration = duration.delay;
var ttlDuration = duration.ttl;
var conf = require('../conf/config');
var redis = require("redis");
var keystore = redis.createClient(conf.redisConf.keys.port, conf.redisConf.keys.host);
var queue = kue.createQueue({
    prefix: conf.name,
    redis: conf.redisConf.queue
});


var saveChannel = function (channelObj) {
    return new Promise(function (resolve, reject) {
        ChannelModel.Model.findOne({site: channelObj.site, dname: channelObj.dname}, function (err, channel) {
            if (err) {
                reject({code: 1, message: "Error : " + err});
            } else {
                if (!channel) {
                    ChannelModel.save(channelObj, function (err) {
                        if (err) {
                            reject({code: 1, message: "Error : " + err});
                        }
                        console.log(channelObj.name + " saved at " + new Date());
                        resolve(true)
                    })
                }
                else if (channel.name != channelObj.name || channel.dname != channelObj.dname || channel.logo != channelObj.logo) {
                    channel.name = channelObj.name;
                    channel.dname = channelObj.dname;
                    channel.logo = channelObj.logo;
                    channel.utime = channelObj.utime;
                    channel.save(function (err) {
                        if (err) {
                            reject({code: 1, message: "Error : " + err});
                        } else {
                            console.log(channelObj.name + "saved at " + new Date());
                            resolve(true)
                        }
                    });
                }
                else {
                    console.log(channelObj.name + " has exsist at " + new Date());
                    resolve(true);
                }
            }
        })
    })
}
var saveChannelEpg = function (flag, channelEpgObj) {
    return new Promise(function (resolve, reject) {
        if (flag) {
            ChannelEpgModel.Model.findOne({
                site: channelEpgObj.site,
                dname: channelEpgObj.dname,
                date: channelEpgObj.date
            }, function (err, channelEpg) {
                if (err) {
                    console.log("find channelEpg Error");
                    reject({code: 1, message: "Error : " + err});
                } else {
                    if (!channelEpg) {
                        ChannelEpgModel.save(channelEpgObj, function (err) {
                            if (err) {
                                console.log("save channelEpg Error");
                                reject({code: 1, message: "Error : " + err});
                            } else {
                                console.log(channelEpgObj.schid + " saved at " + new Date());
                                resolve(true);
                            }
                        })
                    } else {
                        var newEpg = Hasher.GetMD5(JSON.stringify(channelEpgObj.epg));
                        var oldEpgArray = [];
                        channelEpg.epg.forEach(function (item, index) {
                            oldEpgArray.push({
                                starttime: item.starttime,
                                program: item.program
                            })
                        });
                        var oldEpg = Hasher.GetMD5(JSON.stringify(oldEpgArray));
                        //console.log("newEpg :"+newEpg+",oldEpg :"+oldEpg);
                        if (newEpg == oldEpg) {
                            console.log(channelEpgObj.url + " exsist at " + new Date());
                            resolve(true);
                        } else {
                            channelEpg.epg = channelEpgObj.epg;
                            channelEpg.url = channelEpgObj.url;
                            channelEpg.schid = channelEpg.schid;
                            channelEpg.utime = new Date().getTime();
                            console.log(JSON.stringify(channelEpg))
                            channelEpg.save(function (err) {
                                if (err) {
                                    console.log("updatechannelEpg Error");
                                    console.error(err);
                                    reject({code: 1, message: "Error : " + err});
                                } else {
                                    console.log("channelEpg " + channelEpgObj.schid + " update at " + new Date());
                                    resolve(true);
                                }
                            })
                        }
                    }
                }

            });
        } else {
            reject({code: 1, message: "Error : flag is false"});
        }
    });
}
exports.enterDatabase = function (array) {
    var channelObj = array[0];
    var channelEpgObj = array[1];
    var links = array[2];
    var obj = array[3];
    return new Promise(function (resolve, reject) {
        console.log("channel " + channelObj.schid + " ready to enterDatabase at " + new Date());
        return saveChannel(channelObj).then(function (flag) {
            console.log("channelEpg " + channelEpgObj.schid + " ready to enterDataBase at " + new Date());
            return saveChannelEpg(flag, channelEpgObj);
        }).then(function (flag) {
            if (flag) {
                resolve([links, obj]);
            } else {
                reject({code: 1, message: "Error : saveChannelEpg"});
            }
        });
    });
}
exports.pushQueue = function (array) {
    var links = array[0];
    var data = array[1];
    console.log("length = " + links.length + " start pushQueue at " + new Date());
    return Promise.map(links,
        function (link, index) {
            var hash = Hasher.GetSHA1(link);
            return new Promise(function (resolve, reject) {
                keystore.set(hash, 1, 'EX', expireDuration, 'NX', function (err, msg) {
                    if (err) {
                        reject({code: 1, message: "Error : keystore " + err});
                    } else if (msg == 'OK') {
                        queue.create('links', {
                            site: data.site,
                            url: link,
                            pattern: data.pattern,
                            level: data.level + 1,
                            ras: data.ras,
                            headers: data.headers
                        }).attempts(3).backoff({
                            delay: delayDuration,
                            type: 'fixed'
                        }).removeOnComplete(true).ttl(ttlDuration).save(function (err) {
                            if (err) {
                                reject({code: 1, message: "Error : pushQueue " + err})
                            } else {
                                resolve(index);
                            }
                        });
                    } else {
                        resolve("the keystore has exsists");
                    }
                })
            });
        }, {concurrency: 10}).then(function (data) {
    }).catch(function (err) {
        console.error(err);
    });
}
