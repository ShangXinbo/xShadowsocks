const expect = require('chai').expect
const mhttp = require('../http/index')
const magent = require('../http/agent')

describe('http 模块测试', () => {

    describe('http server', () => {
        it('create success', () => {
            mhttp.createServer(30000, () => {
                done()
            })
        })
    })
    describe('agent', () => {
        it('http', () => {
            magent.http(30000, () => {
                done()
            })
        })
        it('https', () => {
            magent.https(30000, () => {
                done()
            })
        })
    })
})