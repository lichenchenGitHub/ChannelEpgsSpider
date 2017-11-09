/**
 * Created by lichenchen on 2016/11/3.
 */
'use strict';

function Channel(site, schid, name, dname, logo) {
    this.site = site;
    this.schid = schid;
    this.name = name;
    this.dname = dname;
    this.logo = logo;

    this.ctime = new Date().getTime();
    this.utime = this.ctime;
}

Channel.prototype.constructor = Channel;

Channel.prototype.toString = function () {
    return JSON.stringify({
        site: this.site,
        schid: this.schid,
        name: this.name,
        dname: this.dname,
        logo: this.logo,
        ctime: this.ctime,
        utime: this.utime,
    });
};

Channel.getMongoDataModel = function (mongoose) {
    var dataModel = {};

    dataModel.mongoose = mongoose;

    dataModel.collectionName = 'channel';
    dataModel.Schema = null;
    dataModel.Model = null;
    dataModel.save = null;

    if (dataModel.mongoose) {
        dataModel.Schema = new dataModel.mongoose.Schema({
            site: {type: String},
            schid: {type: String, unique: true},
            name: {type: String},
            dname: {type: String},
            logo: {type: String},
            ctime: {type: Number},
            utime: {type: Number},
        }, {
            autoIndex: true
        });

        // create compound index, with site 'asc', schid 'asc', name 'asc'
        dataModel.Schema.index({site: 1, dname: 1}, {unique: true});
        dataModel.Schema.index({ctime: 1, utime: 1}, {index: true});

        dataModel.Model = dataModel.mongoose.model(dataModel.collectionName, dataModel.Schema);

        dataModel.save = function (channel, callback) {
            var ch = new dataModel.Model(channel);
            ch.save(callback);
        }
    }

    return dataModel;
};

module.exports = Channel;