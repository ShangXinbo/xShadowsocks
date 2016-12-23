const http = require('http');
const geoipChecker = require('./geoipChecker');
const agent = require('./agent');
const jet = http.createServer();

// proxy an HTTP request.
jet.on('request', (req, res) => {
    geoipChecker(req, (tunnel) => {
        agent.http(tunnel)(req, res);
    });
});

// proxy an HTTPS request.
jet.on('connect', (req, socket, head) => {
    geoipChecker(req, (tunnel) => {
        agent.https(tunnel)(req, socket, head);
    });
});
module.exports = jet;
