const http = require('http')
const url = require('url')
const process = require('process')
const net = require('net')
const Socks = require('socks')
const {localAddr,localPort} = require('../config')
const logger = require('./logger')

// Proxy Setting
const proxy = {
    ipaddress: localAddr,
    port: localPort,
    type: 5
}

// Jet Header
function jetHeader(httpVersion) {
    return `HTTP/${httpVersion} 200 Connection Established\r\n` +
        'Proxy-agent: Jet Proxy\r\n' +
        '\r\n'
}

function agentHttp(direct = true) {
    return function (req, res) {
        const _url = url.parse(req.url)

        const hostname = _url.hostname
        const port = _url.port
        const path = _url.path
        const method = req.method
        const headers = req.headers

        const options = {
            hostname,
            port,
            path,
            method,
            headers
        }

        if (direct) {
            logger.request(req, 'direct')
        } else {
            logger.request(req, 'tunnel')
            options.agent = new Socks.Agent({proxy}, false, false)
        }

        const jetRequest = http.request(options, (_res) => {
            _res.pipe(res)
            res.writeHead(_res.statusCode, _res.headers)
        })

        jetRequest.on('error', (err) => {
            logger.erro(err)
        })
        req.pipe(jetRequest)
    }
}

function agentHttps(direct = true) {
    return function (req, socket, head) {
        const _url = url.parse(`https://${req.url}`)

        const hostname = _url.hostname
        const port = _url.port

        if (direct) {
            logger.request(req, 'direct')

            const jetSocket = net.connect(port, hostname, () => {
                // tell the client that the connection is established
                socket.write(jetHeader(req.httpVersion))
                jetSocket.write(head)
                // creating pipes in both ends
                jetSocket.pipe(socket)
                socket.pipe(jetSocket)
            })

            jetSocket.on('error', (err) => {
                logger.erro(err)
            })
        } else {
            logger.request(req, 'tunnel')

            Socks.createConnection({
                proxy,
                target: {
                    host: hostname,
                    port: port
                },
                command: 'connect'
            }, (err, jetSocket, info) => {
                if (err) {
                    logger.erro(err)
                } else {
                    // tell the client that the connection is established
                    socket.write(jetHeader(req.httpVersion))
                    jetSocket.write(head)
                    // creating pipes in both ends
                    jetSocket.pipe(socket)
                    socket.pipe(jetSocket)
                }
            })
        }
    }
}

module.exports = {
    http: agentHttp,
    https: agentHttps
}
