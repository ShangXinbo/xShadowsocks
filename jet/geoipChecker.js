const fs = require('fs')
const path = require('path')
const dns = require('dns')
const debug = require('debug')('geoipChecker')
const ip = require('ip')
const {dnsServer} = require('../config')
const logger = require('./logger')

let cidrs
const geoipFile = path.join(__dirname, './GeoIP-CN')

/**
 set DNS server manually
 */
const dnsServers = dnsServer;
if (dnsServers.length > 0) {
    dns.setServers(dnsServers)
}

function readGeoIPList() {
    return fs.readFileSync(geoipFile, 'utf8').split('\n')
        .filter(function (rx) {  // filter blank cidr
            return rx.length
        })
}

function update() {
    logger.info('Reading GeoIP Rules...')
    cidrs = new Set([...readGeoIPList()])
    debug(cidrs)
}

function isip(str) {
    return /^(([1-9]?\d|1\d\d|2[0-4]\d|25[0-5])(\.(?!$)|$)){4}$/.test(str)
}

function direct(address, cb) {
    for (let cidr of cidrs) {
        if (ip.cidrSubnet(cidr).contains(address)) {
            return cb(true)
        }
    }
    return cb(false)
}

function checker(req, cb) {
    const hostname = req.headers.host.split(':')[0];    //host:port

    if (isip(hostname)) {
        const address = hostname
        return direct(address, cb)
    } else {
        dns.resolve4(hostname, (err, addresses) => {   //查询ipv4地址
            if (err) {
                return logger.info(`Failed to resolve: ${hostname}`)
            }

            // only use the first address
            const address = addresses[0]
            return direct(address, cb)
        })
    }
}

logger.info(`Current DNS: ${dns.getServers()}`)
fs.watch(geoipFile, () => {
    update()
})
update()

module.exports = checker
