/**
 * Created by lichenchen on 2016/11/3.
 */
'use strict';

function ChannelEpg(site, schid, date, url,dname) {
    this.site = site;
    this.schid = schid;
    this.date = date;
    this.url = url;
    this.dname=dname;
    this.epg = [];

    this.ctime = new Date().getTime();
    this.utime = this.ctime;
}

ChannelEpg.prototype.constructor = ChannelEpg;

ChannelEpg.prototype.toString = function () {
    return JSON.stringify({
        site: this.site,
        schid: this.schid,
        date: this.date,
        url: this.url,
        dname:this.dname,
        epg: this.epg,
        ctime: this.ctime,
        utime: this.utime,
    });
};

ChannelEpg.prototype.addProgram = function (starttime, program) {
    if (!starttime || !program) {
        return;
    }
    this.epg.push({
        starttime: starttime,
        program: program
    });
}

ChannelEpg.getMongoDataModel = function (mongoose) {
    var dataModel = {};

    dataModel.mongoose = mongoose;

    dataModel.collectionName = 'channel_epg';
    dataModel.Schema = null;
    dataModel.ItemSchema = null;
    dataModel.Model = null;
    dataModel.save = null;

    if (dataModel.mongoose) {
        dataModel.ItemSchema = new dataModel.mongoose.Schema({
            starttime: { type: Number },
            program: { type: String }
        }, {
            autoIndex: false
        });

        dataModel.Schema = new dataModel.mongoose.Schema({
            site: { type: String },
            schid: { type: String },
            date: { type: Number },
            url: { type: String },
            dname: { type: String },
            epg: [dataModel.ItemSchema],
            ctime: { type: Number },
            utime: { type: Number },
        }, {
            autoIndex: true
        });

        // create compound index, with chname 'asc' and date 'desc'
        dataModel.Schema.index({ site: 1, dname: 1, date: -1 }, { unique: true });
        dataModel.Schema.index({ ctime: 1, utime: 1 }, { index: true });

        dataModel.Model = dataModel.mongoose.model(dataModel.collectionName, dataModel.Schema);

        dataModel.save = function (channelepg, callback) {
            var chepg = new dataModel.Model(channelepg);
            chepg.save(callback);
        }
    }

    return dataModel;
}

module.exports = ChannelEpg;