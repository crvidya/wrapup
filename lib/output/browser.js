"use strict";

var fs         = require('fs')
var prime      = require('prime')
var async      = require('async')
var util       = require('../util')
var singleFile = require('./_singleFile')

var getWrapperAST  = util.getAST('browser-wrapper')
var getModuleAST   = util.getAST('browser-module')
var getNamedAST    = util.getAST('browser-named')
var getNamelessAST = util.getAST('browser-nameless')
var getVarNamedAST = util.getAST('var-named')

var output = prime({

    inherits: require('./'),

    // mixin method
    outputSingleFile: singleFile.prototype.outputSingleFile,

    up: function(callback){
        var self = this
        async.parallel([
            getWrapperAST,
            this._options.globalize ? getNamedAST : getVarNamedAST,
            getModuleAST,
            getNamelessAST
        ], function(err, results){
            if (err) return callback(err)
            self.output(callback, results[0], results[1], results[2], results[3])
        })
        return this
    },

    output: function(callback, wrapperAST, namedAST, moduleAST, namelessAST){

        var self      = this
        var options   = this._options
        var globalize = options.globalize
        var wrapper   = util.clone(wrapperAST)
        var varStmts  = []

        // the closure function
        var wrapperClosure = wrapper.body[0].expression

        // the position where we can insert the modules
        var properties = wrapperClosure['arguments'][0].properties

        prime.each(this.modules, function(module){

            if (module.err) return

            var ast = module.ast

            // module key and value
            var newAST = util.clone(moduleAST.body[0].declarations[0].init.properties[0])
            newAST.key.value = module.uid
            var body = newAST.value.body.body

            // put the module JS into the module function
            for (var i = 0; i < ast.body.length; i++){
                body.push(ast.body[i])
            }

            // and the module function in the "modules" object
            properties.push(newAST)

            // replace "require('...')" with the module id or replace the
            // entire require() with null if the required module doesn't exist.
            for (var r = 0; r < module.requires.length; r++){
                var req = module.requires[r]
                var dep = module.deps[r]
                if (dep){
                    req.require['arguments'][0].value = dep
                } else {
                    req.parent[req.key] = {type: "Literal", value: null}
                }
            }
        })

        // body where to place "require('0')" and "window['foo'] = require('1')"
        var wrapperBody = wrapperClosure.callee.body.body

        // "global[name] = require('...')" named modules, that need to be exported
        prime.each(this.named, function(id, name){
            var named = util.clone(namedAST.body[0])
            var expression = named.expression, left = expression.left
            if (globalize){
                // adding modules to a global object inside the wrapper closure
                left.object.name = globalize
                left.property.value = name
                expression.right['arguments'][0].value = id
            } else {
                // adding global var statements at the top of the file
                left.name = name
                expression.right['arguments'][0].value = id
                varStmts.push({
                    type: "VariableDeclarator",
                    id: {type: "Identifier", name: name}
                })
            }
            wrapperBody.push(named)
        })

        if (varStmts.length) wrapper.body.unshift({
            type: "VariableDeclaration", declarations: varStmts, kind: "var"
        })

        // nameless requires, "require("...")"
        this.nameless.forEach(function(id){
            var nameless = util.clone(namelessAST.body[0])
            nameless.expression['arguments'][0].value = id
            wrapperBody.push(nameless)
        })

        this.outputSingleFile(wrapper, callback)

    }

})

module.exports = function(wrup, callback){
    new output(wrup).up(callback)
}
