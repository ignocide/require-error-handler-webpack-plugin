/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
	Modified by Richard Scarrott @richardscarrott
*/
var Template = require('webpack/lib/Template');
var JsonpMainTemplatePlugin;

/**
 * Patches the `JsonpMainTemplatePlugin` with jsonp error handling logic.
 * @param {JsonpMainTemplatePlugin} plugin The plugin to be patched.
 */
function JsonpErrorHandlerPlugin(plugin) {
	JsonpMainTemplatePlugin = plugin;
}

module.exports = JsonpErrorHandlerPlugin;

/**
 * Indicates whether the `JsonpMainTemplatePlugin` has been patched.
 * @type {Boolean}
 */
JsonpErrorHandlerPlugin.prototype.patched = false;

/**
 * Applies the patch.
 */
JsonpErrorHandlerPlugin.prototype.apply = function() {
	if (!this.patched) {
		this.patchJsonpMainTemplatePlugin();
	}
};

/**
 * Patches the `JsonpMainTemplatePlugin` with jsonp error handling logic.
 */
JsonpErrorHandlerPlugin.prototype.patchJsonpMainTemplatePlugin = function() {
	JsonpMainTemplatePlugin.prototype.apply = this._apply;
	JsonpErrorHandlerPlugin.prototype.patched = true;
};

/**
 * Adds the error handling logic by tapping into the main template plugin hooks.
 * This is mostly taken from 'webpack/lib/JsonpMainTemplatePlugin'.
 * @param  {MainTemplate} mainTemplate The main template.
 */
JsonpErrorHandlerPlugin.prototype._apply = function(mainTemplate) {
	mainTemplate.plugin("local-vars", function(source, chunk, hash) {
		if(chunk.chunks.length > 0) {
			return this.asString([
				source,
				"",
				"// object to store loaded and loading chunks",
				'// "0" means "already loaded"',
				'// Array means "loading", array contains callbacks',
				"var installedChunks = {",
				this.indent(
					chunk.ids.map(function(id) {
						return id + ":0"
					}).join(",\n")
				),
				"};"
			]);
		}
		return source;
	});
	mainTemplate.plugin("require-ensure", function(_, chunk, hash) {
		var filename = this.outputOptions.filename || "bundle.js";
		var chunkFilename = this.outputOptions.chunkFilename || "[id]." + filename;
		var chunkMaps = chunk.getChunkMaps();
		return this.asString([
			"};", // HACK: the requireEnsure signature is defined in the mainTemplate so need to override it here...
			this.requireFn + ".e = function requireEnsure(chunkId, successCallback, errorCallback) {",
			this.indent([
				"errorCallback = errorCallback || function() {};",
				"// \"0\" is the signal for \"already loaded\"",
				"if (installedChunks[chunkId] === 0)",
				this.indent("return successCallback.call(null, " + this.requireFn + ");"),
				"",
				"// an array means \"currently loading\".",
				"if (installedChunks[chunkId] !== undefined) {",
				this.indent([
					"installedChunks[chunkId].push({",
					this.indent([
						"success: successCallback,",
						"error: errorCallback"
					]),
					"});",
				]),
				"} else {",
				this.indent([
					"// start chunk loading",
					"installedChunks[chunkId] = [{",
					this.indent([
						"success: successCallback,",
						"error: errorCallback"
					]),
					"}];",
					"loadChunk(chunkId)"
				]),
				"}"
			])
		]);
	});
	mainTemplate.plugin("bootstrap", function(source, chunk, hash) {
		if(chunk.chunks.length > 0) {
			var jsonpFunction = this.outputOptions.jsonpFunction || Template.toIdentifier("webpackJsonp" + (this.outputOptions.library || ""));
			var filename = this.outputOptions.filename || "bundle.js";
			var chunkFilename = this.outputOptions.chunkFilename || "[id]." + filename;
			var chunkMaps = chunk.getChunkMaps();
			return this.asString([
				source,
				"",
				"// install a JSONP callback for chunk loading",
				"var parentJsonpFunction = window[" + JSON.stringify(jsonpFunction) + "];",
				"window[" + JSON.stringify(jsonpFunction) + "] = function webpackJsonpCallback(chunkIds, moreModules) {",
				this.indent([
					'// add "moreModules" to the modules object,',
					'// then flag all "chunkIds" as loaded and fire callback',
					"var moduleId, chunkId, i = 0, callbacks = [];",
					"for(;i < chunkIds.length; i++) {",
					this.indent([
						"chunkId = chunkIds[i];",
						"if(installedChunks[chunkId])",
						this.indent("callbacks.push.apply(callbacks, installedChunks[chunkId]);"),
						"installedChunks[chunkId] = 0;"
					]),
					"}",
					"for(moduleId in moreModules) {",
					this.indent(this.renderAddModule(hash, chunk, "moduleId", "moreModules[moduleId]")),
					"}",
					"if(parentJsonpFunction) parentJsonpFunction(chunkIds, moreModules);",
					"while(callbacks.length)",
					this.indent("callbacks.shift().success.call(null, " + this.requireFn + ");"),
					(this.entryPointInChildren(chunk) ? [
						"if(moreModules[0]) {",
						this.indent([
							"installedModules[0] = 0;",
							"return " + this.requireFn + "(0);"
						]),
						"}"
					] : "")
				]),
				"};",
				"",
				"// load chunk",
				"function loadChunk(chunkId) {",
				this.indent([
					"var head = document.getElementsByTagName('head')[0];",
					"var script = document.createElement('script');",
					"script.type = 'text/javascript';",
					"script.charset = 'utf-8';",
					"script.async = true;",
					"function onComplete(error) {",
						this.indent([
							"// avoid mem leaks in IE.",
							"script.onerror = script.onload = script.onreadystatechange = null;",
							"if (error) {",
							this.indent([
								"var callbacks = installedChunks[chunkId];",
								"// set chunkId to undefined so subsequent require's try again",
								"delete installedChunks[chunkId];",
								"if (callbacks) {",
								this.indent([
									"while(callbacks.length) {",
										this.indent([
											"callbacks.shift().error.call(null, __webpack_require__);",
										]),
									"}"
								]),
								'}',
							]),
							'}',
							"// success callbacks will be called by webpackJsonpCallback handler"
						]),
					"}",
					"script.onerror = script.onload = script.onreadystatechange = function() {",
					this.indent([
						"// cover buggy onerror / readystate implementations by checking whether the chunk is actually installed",
						"onComplete(installedChunks[chunkId] !== 0);"
					]),
					"};",
					"script.src = " + this.requireFn + ".p + " +
					this.applyPluginsWaterfall("asset-path", JSON.stringify(chunkFilename), {
						hash: "\" + " + this.renderCurrentHashCode(hash) + " + \"",
						hashWithLength: function(length) {
							return "\" + " + this.renderCurrentHashCode(hash, length) + " + \"";
						}.bind(this),
						chunk: {
							id: "\" + chunkId + \"",
							hash: "\" + " + JSON.stringify(chunkMaps.hash) + "[chunkId] + \"",
							hashWithLength: function(length) {
								var shortChunkHashMap = {};
								Object.keys(chunkMaps.hash).forEach(function(chunkId) {
									if(typeof chunkMaps.hash[chunkId] === "string")
										shortChunkHashMap[chunkId] = chunkMaps.hash[chunkId].substr(0, length);
								});
								return "\" + " + JSON.stringify(shortChunkHashMap) + "[chunkId] + \"";
							},
							name: "\" + (" + JSON.stringify(chunkMaps.name) + "[chunkId]||chunkId) + \""
						}
					}) + ";",
					"head.appendChild(script);"
				]),
				"}"
			]);
		}
		return source;
	});
	mainTemplate.plugin("hot-bootstrap", function(source, chunk, hash) {
		var hotUpdateChunkFilename = this.outputOptions.hotUpdateChunkFilename;
		var hotUpdateMainFilename = this.outputOptions.hotUpdateMainFilename;
		var hotUpdateFunction = this.outputOptions.hotUpdateFunction || Template.toIdentifier("webpackHotUpdate" + (this.outputOptions.library || ""));
		var currentHotUpdateChunkFilename = this.applyPluginsWaterfall("asset-path", JSON.stringify(hotUpdateChunkFilename), {
			hash: "\" + " + this.renderCurrentHashCode(hash) + " + \"",
			hashWithLength: function(length) {
				return "\" + " + this.renderCurrentHashCode(hash, length) + " + \"";
			}.bind(this),
			chunk: {
				id: "\" + chunkId + \""
			}
		});
		var currentHotUpdateMainFilename = this.applyPluginsWaterfall("asset-path", JSON.stringify(hotUpdateMainFilename), {
			hash: "\" + " + this.renderCurrentHashCode(hash) + " + \"",
			hashWithLength: function(length) {
				return "\" + " + this.renderCurrentHashCode(hash, length) + " + \"";
			}.bind(this)
		});
		return source + "\n"+
			"var parentHotUpdateCallback = this[" + JSON.stringify(hotUpdateFunction) + "];\n" +
			"this[" + JSON.stringify(hotUpdateFunction) + "] = " + Template.getFunctionContent(function() {
			function webpackHotUpdateCallback(chunkId, moreModules) {
				hotAddUpdateChunk(chunkId, moreModules);
				if(parentHotUpdateCallback) parentHotUpdateCallback(chunkId, moreModules);
			}

			function hotDownloadUpdateChunk(chunkId) {
				var head = document.getElementsByTagName('head')[0];
				var script = document.createElement('script');
				script.type = 'text/javascript';
				script.charset = 'utf-8';
				script.src = $require$.p + $hotChunkFilename$;
				head.appendChild(script);
			}

			function hotDownloadManifest(callback) {
				if(typeof XMLHttpRequest === "undefined")
					return callback(new Error("No browser support"));
				try {
					var request = new XMLHttpRequest();
					var requestPath = $require$.p + $hotMainFilename$;
					request.open("GET", requestPath, true);
					request.timeout = 10000;
					request.send(null);
				} catch(err) {
					return callback(err);
				}
				request.onreadystatechange = function() {
					if(request.readyState !== 4) return;
					if(request.status === 0) {
						// timeout
						callback(new Error("Manifest request to " + requestPath + " timed out."));
					} else if(request.status === 404) {
						// no update available
						callback();
					} else if(request.status !== 200 && request.status !== 304) {
						// other failure
						callback(new Error("Manifest request to " + requestPath + " failed."));
					} else {
						// success
						try {
							var update = JSON.parse(request.responseText);
						} catch(e) {
							callback(e);
							return;
						}
						callback(null, update);
					}
				};
			}
		})
			.replace(/\$require\$/g, this.requireFn)
			.replace(/\$hotMainFilename\$/g, currentHotUpdateMainFilename)
			.replace(/\$hotChunkFilename\$/g, currentHotUpdateChunkFilename)
			.replace(/\$hash\$/g, JSON.stringify(hash))
	});
	mainTemplate.plugin("hash", function(hash) {
		hash.update("jsonp");
		hash.update("4");
		hash.update(this.outputOptions.filename + "");
		hash.update(this.outputOptions.chunkFilename + "");
		hash.update(this.outputOptions.jsonpFunction + "");
		hash.update(this.outputOptions.library + "");
	});
};
