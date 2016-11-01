"use strict";

const request = require('sync-request');                 //同步请求
const fs = require('fs');
const cdr = require("child_process");
const winston = require('winston');                      //日志插件

const CONF = require('./config.js');                     //项目配置文件
const MESSAGE = require(CONF.app.language);              //日志文字映射
const crawler = require('./crawler');


winston.add(winston.transports.File, {filename: CONF.app.log_file}); //日志文件配置
winston.remove(winston.transports.Console);

let runingProcess = '';

update(true);
setInterval(function () {
    update();
}, 60 * 1000 * config.app.interval);

function update(init) {
    let dymicArr = []
    for (let i = 0; i < crawler.length; i++) {
        let data = grab(crawler[i].url);
        if (data) {
            let arr = crawler[i].deXml(data);
            if(arr){
                dymicArr = dymicArr.concat(arr);
            }
        }
    }
    CONF.shadowsocks.configs = dymicArr;
    save(CONF.shadowsocks);
}

/**
 * 抓取信息
 * @param options.url
 * @param options.success
 * @param options.error
 * @return null
 */
function grab(url) {
    var res = request('GET', url);
    if (res.statusCode == 200) {
        return res.getBody();
    } else {
        winston.error('请求失败'); //TODO
        return null;
    }
}

function save(configs) {
    fs.writeFile(CONF.app.exe_path + 'gui-config.json', JSON.stringify(configs), function (err) {
        if (err) {
            winston.error(MESSAGE.SAVE_CONFIG_ERROR);
        }
        if (runingProcess) {
            runingProcess.kill();
            winston.error(MESSAGE.STOP_PROCESS);
        }
        cdr.exec('taskkill /f /FI "IMAGENAME eq shadowsocks.exe', function (error, stdout, stderr) {
            if (error) {
                winston.error(MESSAGE.STOP_SS_ERROR);
            }
            runingProcess = cdr.execFile(CONF.app.exe_path + 'Shadowsocks.exe', [], {}, function () {
                winston.info(MESSAGE.START_PROCESS);
            });
        });
    });
}

