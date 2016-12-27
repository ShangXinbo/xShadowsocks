const ip = require('ip');
const _createServer = require('net').createServer;
const connect = require('net').connect;
const getDstInfo = require('./utils').getDstInfo;
const writeOrPause = require('./utils').writeOrPause;
const createCipher = require('./encryptor').createCipher;
const createDecipher = require('./encryptor').createDecipher;

/**
* 接受客户端发送请求来协商版本及认证方式
* +----+----------+----------+
* |VER | NMETHODS | METHODS  |
* +----+----------+----------+
* | 1  |    1     | 1 to 255 |
* +----+----------+----------+
* VER是SOCKS版本，这里应该是0x05；
* NMETHODS是METHODS部分的长度；
* METHODS是客户端支持的认证方式列表，每个方法占1字节。当前的定义是：
** 0x00 不需要认证
** 0x01 GSSAPI
** 0x02 用户名、密码认证
** 0x03 - 0x7F由IANA分配（保留）
** 0x80 - 0xFE为私人方法保留
** 0xFF 无可接受的方法
* 服务端选择一种验证方式返回给客户端
**/
function agreeMode(connection, data) {

    const buf = new Buffer(2);

    if (data.indexOf(0x00, 2) >= 0) { //不需要认证
        buf.writeUInt16BE(0x0500);
        connection.write(buf);
        return 1;
    } else {
        buf.writeUInt16BE(0x05FF);    //不接受其他方法，客户端需要关闭链接
        connection.write(buf);
        connection.end();
        return -1;
    }
}

function handleRequest(proxy, data, {
    serverAddr,
    serverPort,
    password,
    method,
}, onConnect, onDestroy, clientConnected) {

    let tmp = null;
    let decipher = null;
    let decipheredData = null;
    let cipher = null;
    let cipheredData = null;

    // 本地socks和云端socks桥接
    const tunnel = connect({
        port: serverPort,
        host: serverAddr
    }, () => onConnect());

    tunnel.on('data', (remoteData) => {
        if (!decipher) {
            tmp = createDecipher(password, method, remoteData);
            if (!tmp) {
                onDestroy();
                return;
            }
            decipher = tmp.decipher;
            decipheredData = tmp.data;
        } else {
            decipheredData = decipher.update(remoteData);
        }

        if (clientConnected) {
            writeOrPause(tunnel, proxy, decipheredData);
        } else {
            tunnel.destroy();
        }
    });

    tunnel.on('drain', () => proxy.resume());

    tunnel.on('end', () => proxy.end());

    tunnel.on('error', (e) => onDestroy());

    tunnel.on('close', (e) => {
        if (e) {
            proxy.destroy();
        } else {
            proxy.end();
        }
    });

    return tunnel;
}

/**
 * @method 处理代理请求
 * @param proxy  本地代理链接
 * @param config 配置
* */
function handleConnection(proxy, config) {

    let stage = 0;
    let tunnel;
    let tmp;
    let cipher;
    let remoteConnected = false;
    let clientConnected = true;
    let timer = null;

    proxy.on('data', (data) => {
        if (stage == 0) {
            stage = agreeMode(proxy, data);
        } else if (stage == 1) {
            tunnel = handleRequest(proxy, data, config,
                () => {
                    remoteConnected = true;
                },
                () => {
                    if (remoteConnected) {
                        remoteConnected = false;
                        tunnel.destroy();
                    }
                    if (clientConnected) {
                        clientConnected = false;
                        proxy.destroy();
                    }
                },
                clientConnected
            );

            //向应用层返回状态
            // +----+-----+-------+------+----------+----------+
            // |VER | CMD |  RSV  | ATYP | DST ADDR | DST PROT |
            // +----+-----+-------+------+----------+----------+
            // | 1  |  1  | 0x00  |  1   | Variable |    2     |
            // +----+-----+-------+------+----------+----------+
            // <Buffer 05 01 00 03 11 77 77 77 2e 67 6f 6f 67 6c 65 2e 63 6f 6d 2e 68 6b 01 bb>
            // VER是SOCKS版本，这里应该是0x05；
            // CMD是SOCKS的命令码:0x01表示CONNECT请求,0x02表示BIND请求,0x03表示UDP转发
            // RSV 0x00，保留
            // ATYP 地址类型 0x01 IPv4; 0x03 域名; 0x04 ipv6
            // DST ADDR 目的地址
            // DST PROT 目的端口
            // +----+-----+-------+------+----------+----------+
            // |VER | REP |  RSV  | ATYP | BND.ADDR | BND.PORT |
            // +----+-----+-------+------+----------+----------+
            // | 1  |  1  | 0x00  |  1   | Variable |    2     |
            // +----+-----+-------+------+----------+----------+
            // VER是SOCKS版本，这里应该是0x05；
            // REP应答字段
            //* 0x00表示成功
            //* 0x01普通SOCKS服务器连接失败
            //* 0x02现有规则不允许连接
            //* 0x03网络不可达
            //* 0x04主机不可达
            //* 0x05连接被拒
            //* 0x06 TTL超时
            //* 0x07不支持的命令
            //* 0x08不支持的地址类型
            //* 0x09 - 0xFF未定义
            // RSV 0x00，保留
            // ATYP BND.ADDR地址类型 0x01 IPv4; 0x03 域名; 0x04 ipv6
            // BND ADDR服务器绑定的地址
            // BND PROT网络字节序表示的服务器绑定的端口
            let resBuf = new Buffer(10);
            resBuf.writeUInt32BE(0x05000001);
            resBuf.writeUInt32BE(0x00000000, 4, 4);
            resBuf.writeUInt16BE(0, 8, 2);
            proxy.write(resBuf);
            stage = 2;
            //向服务端吐数据
            let encrypt = createCipher(config.password, config.method, data.slice(3)); // skip VER, CMD, RSV
            cipher = encrypt.cipher;
            cipheredData = encrypt.data;
            writeOrPause(proxy, tunnel, cipheredData);

        } else if (stage == 2) {
            tmp = cipher.update(data);
            writeOrPause(proxy, tunnel, tmp);
        }
    }).on('drain', () => {
        if (remoteConnected) {
            tunnel.resume();
        }
    }).on('end', () => {
        clientConnected = false;
        if (remoteConnected) {
            tunnel.end();
        }
    }).on('close', (e) => {
        if (timer) {
            clearTimeout(timer);
        }

        clientConnected = false;

        if (remoteConnected) {
            if (e) {
                tunnel.destroy();
            } else {
                tunnel.end();
            }
        }
    });

    timer = setTimeout(function () {
        if (clientConnected) {
            proxy.destroy();
        }
        if (remoteConnected) {
            tunnel.destroy();
        }
    }, config.timeout * 1000);
}

exports.createServer = function (config) {
    const server = _createServer(c => handleConnection(c, config));

    server.on('close', () => console.log('server close'));
    server.on('error', e => console.log(e));
    server.on('connection', function () {
        console.log('tcp server connected');
    });
    server.on('listening', function () {
        console.log(`TCP listening on ${config.localPort}…`);
    });
    server.listen(config.localPort);
}