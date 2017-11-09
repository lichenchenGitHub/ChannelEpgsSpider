var express = require('express');
var mongoose = require('../lib/mongoose');
var Channel = require('../model/tv/channel');
var ChannelEpg = require('../model/tv/channelepg');
var ChannelModel = Channel.getMongoDataModel(mongoose);
var ChannelEpgModel = ChannelEpg.getMongoDataModel(mongoose);
var router = express.Router();
var rdata = {
    code: -1,
    data: null,
    count: 0,
    message: "inner error"
}

/* GET home page. */
router.get('/', function (req, res, next) {
    res.render('index', {title: 'Program_Notice'});
});
router.post("/getChannel", function (req, res, next) {
    var query = {};
    if (req.body.site) {
        query.site = req.body.site;
    }
    var sort_rules = {
        schid: 1
    };
    ChannelModel.Model.find(query, null, {sort: sort_rules}, function (err, contents) {
        if (err) {
            return res.status(500).json(rdata);
        } else {
            rdata.code = 0;
            rdata.data = contents;
            rdata.count = contents.length;
            rdata.message = "success";
            return res.status(200).json(rdata);
        }

    })
})
router.post("/getSchid", function (req, res, next) {
    var query = {};
    if (req.body.site) {
        query.site = req.body.site;
    }
    var sort_rules = {
        schid: 1
    };
    ChannelModel.Model.find(query, {schid: 1, dname: 1}, {sort: sort_rules}, function (err, contents) {
        if (err) {
            return res.status(500).json(rdata);
        } else {
            rdata.code = 0;
            rdata.data = contents;
            rdata.count = contents.length;
            rdata.message = "success";
            return res.status(200).json(rdata);
        }

    });
})
router.post("/getChannelEpg", function (req, res, next) {
    var query = {};
    if (req.body.site) {
        query.site = req.body.site;
    }
    if (req.body.dname) {
        query.dname = req.body.dname;
    }
    if (req.body.date) {
        query.date = req.body.date;
    } else {
        if (req.body.startTime) {
            query.date = {$gte: req.body.startTime}
        }
        if (req.body.endTime && !req.body.startTime) {
            query.date = {$lt: req.body.endTime}
        }
        if (req.body.endTime && req.body.startTime) {
            query.date.$lt = req.body.endTime;
        }
    }
    var sort_rules = {
        date: -1
    };
    console.log(query);
    ChannelEpgModel.Model.find(query, {
        _id: 1,
        site: 1,
        dname: 1,
        schid: 1,
        url: 1,
        date: 1,
        utime: 1
    }, {sort: sort_rules}, function (err, contents) {
        if (err) {
            return res.status(500).json(rdata);
        } else {
            rdata.code = 0;
            rdata.data = contents;
            rdata.count = contents.length;
            rdata.message = "success";
            return res.status(200).json(rdata);
        }
    })
})
router.post("/getChannelEpgEntity", function (req, res, next) {
    var query = {};
    if (req.body.site) {
        query.site = req.body.site;
    }
    if (req.body.schid) {
        query.schid = req.body.schid;
    }
    if (req.body.date) {
        query.date = req.body.date;
    } else {
        if (req.body.startTime) {
            query.date = {$gte: req.body.startTime}
        }
        if (req.body.endTime && !req.body.startTime) {
            query.date = {$lt: req.body.endTime}
        }
        if (req.body.endTime && req.body.startTime) {
            query.date.$lt = req.body.endTime;
        }
    }
    ChannelEpgModel.Model.findOne(query, function (err, content) {
        if (err) {
            return res.status(500).json(rdata);
        } else {
            rdata.code = 0;
            rdata.data = content;
            rdata.count = 1;
            rdata.message = "success";
            return res.status(200).json(rdata);
        }
    })
})
router.post("/getEpgById", function (req, res, next) {
    var query = {};
    if (req.body._id) {
        query._id = req.body._id;
        ChannelEpgModel.Model.findOne(query, function (err, content) {
            rdata.code = 0;
            rdata.data = content;
            rdata.count = content.length;
            rdata.message = "success";
            return res.status(200).json(rdata);
        })

    } else {
        rdata.message = "lack params";
        return res.status(404).json(rdata);
    }
})
router.post("/getEpgByArr", function (req, res, next) {
    if (req.body.arr && req.body.arr != '') {
        var arr = req.body.arr.split(",");
        var query = {_id: {$in: arr}};
        ChannelEpgModel.Model.find(query, function (err, contents) {
            if (err) {
                return res.status(500).json(rdata);
            } else {
                rdata.code = 0;
                rdata.data = contents;
                rdata.count = contents.length;
                rdata.message = "success";
                return res.status(200).json(rdata);
            }
        })
    } else {
        if (err) {
            return res.status(500).json(rdata);
        }
    }
})

module.exports = router;
