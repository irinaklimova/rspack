"use strict";

require("./helpers/warmup-webpack");
const path = require("path");
const fs = require("graceful-fs");
const { rimrafSync } = require("rimraf");
const captureStdio = require("./helpers/captureStdio");
const webpack = require("@rspack/core");
const { createFilteredDescribe } = require('./lib/util/filterUtil')

/**
 * Escapes regular expression metacharacters
 * @param {string} str String to quote
 * @returns {string} Escaped string
 */
const quoteMeta = str => {
	return str.replace(/[-[\]\\/{}()*+?.^$|]/g, "\\$&");
};

const base = path.join(__dirname, "statsCases");
const outputBase = path.join(__dirname, "js", "stats");
const tests = fs
	.readdirSync(base)
	.filter(
		testName =>
			fs.existsSync(path.join(base, testName, "index.js")) ||
			fs.existsSync(path.join(base, testName, "webpack.config.js"))
	)
	.filter(testName => {
		const testDirectory = path.join(base, testName);
		const filterPath = path.join(testDirectory, "test.filter.js");
		return createFilteredDescribe(testName, filterPath);
	});

describe("StatsTestCases", () => {
	jest.setTimeout(30000);
	let stderr;
	// CHANGE: prevent beforeEach() be used in a describe block containing no tests
	if (tests.length) {
		beforeEach(() => {
			stderr = captureStdio(process.stderr, true);
		});
	}
	// CHANGE: prevent afterEach() be used in a describe block containing no tests
	if (tests.length) {
		afterEach(() => {
			stderr.restore();
		});
	}
	tests.forEach(testName => {
		it("should print correct stats for " + testName, done => {
			const outputDirectory = path.join(outputBase, testName);
			rimrafSync(outputDirectory);
			fs.mkdirSync(outputDirectory, { recursive: true });
			let options = {
				mode: "development",
				entry: "./index",
				output: {
					filename: "bundle.js"
				},
			};
			if (fs.existsSync(path.join(base, testName, "webpack.config.js"))) {
				options = require(path.join(base, testName, "webpack.config.js"));
			}
			let testConfig = {};
			try {
				// try to load a test file
				testConfig = Object.assign(
					testConfig,
					require(path.join(base, testName, "test.config.js"))
				);
			} catch (e) {
				// ignored
			}

			(Array.isArray(options) ? options : [options]).forEach(options => {
				// CHANGE: rspack does not enable AMD by default
				if (options.amd === undefined) options.amd = {};
				if (!options.context) options.context = path.join(base, testName);
				if (!options.output) options.output = options.output || {};
				if (!options.output.path) options.output.path = outputDirectory;
				if (!options.plugins) options.plugins = [];
				if (!options.optimization) options.optimization = {};
				if (options.optimization.minimize === undefined)
					options.optimization.minimize = false;
				if (!options.experiments) options.experiments = {};
				if (!options.experiments.rspackFuture) options.experiments.rspackFuture = {};
				if (!options.experiments.rspackFuture.bundlerInfo) options.experiments.rspackFuture.bundlerInfo = {};
				if (options.experiments.rspackFuture.bundlerInfo.force === undefined) options.experiments.rspackFuture.bundlerInfo.force = false;
			});
			const c = webpack(options);
			const compilers = c.compilers ? c.compilers : [c];
			compilers.forEach(c => {
				const ifs = c.inputFileSystem;
				c.inputFileSystem = Object.create(ifs);
				c.inputFileSystem.readFile = function () {
					const args = Array.prototype.slice.call(arguments);
					const callback = args.pop();
					ifs.readFile.apply(
						ifs,
						args.concat([
							(err, result) => {
								if (err) return callback(err);
								if (!/\.(js|json|txt)$/.test(args[0]))
									return callback(null, result);
								callback(null, result.toString("utf-8").replace(/\r/g, ""));
							}
						])
					);
				};

				// CHANGE: The checkConstraints() function is currently not implemented in rspack
				// c.hooks.compilation.tap("StatsTestCasesTest", compilation => {
				// 	[
				// 		"optimize",
				// 		"optimizeModules",
				// 		"optimizeChunks",
				// 		"afterOptimizeTree",
				// 		"afterOptimizeAssets",
				// 		"beforeHash"
				// 	].forEach(hook => {
				// 		compilation.hooks[hook].tap("TestCasesTest", () =>
				// 			compilation.checkConstraints()
				// 		);
				// 	});
				// });
			});
			c.run((err, stats) => {
				if (err) return done(err);
				for (const compilation of []
					.concat(stats.stats || stats)
					.map(s => s.compilation)) {
					compilation.logging.delete("webpack.Compilation.ModuleProfile");
				}
				if (/error$/.test(testName)) {
					expect(stats.hasErrors()).toBe(true);
				} else if (stats.hasErrors()) {
					return done(
						new Error(
							stats.toString({
								all: false,
								errors: true,
								errorStack: true,
								errorDetails: true
							})
						)
					);
				} else {
					fs.writeFileSync(
						path.join(outputBase, testName, "stats.txt"),
						stats.toString({
							preset: "verbose",
							context: path.join(base, testName),
							colors: false
						}),
						"utf-8"
					);
				}
				let toStringOptions = {
					context: path.join(base, testName),
					colors: false
				};
				let hasColorSetting = false;
				if (typeof c.options.stats !== "undefined") {
					toStringOptions = c.options.stats;
					if (toStringOptions === null || typeof toStringOptions !== "object")
						toStringOptions = { preset: toStringOptions };
					if (!toStringOptions.context)
						toStringOptions.context = path.join(base, testName);
					hasColorSetting = typeof toStringOptions.colors !== "undefined";
				}
				if (Array.isArray(c.options) && !toStringOptions.children) {
					toStringOptions.children = c.options.map(o => o.stats);
				}
				// mock timestamps
				for (const { compilation: s } of [].concat(stats.stats || stats)) {
					expect(s.startTime).toBeGreaterThan(0);
					expect(s.endTime).toBeGreaterThan(0);
					s.endTime = new Date("04/20/1970, 12:42:42 PM").getTime();
					s.startTime = s.endTime - 1234;
				}
				let actual = stats.toString(toStringOptions);
				expect(typeof actual).toBe("string");
				if (!hasColorSetting) {
					actual = stderr.toString() + actual;
					actual = actual
						.replace(/\u001b\[[0-9;]*m/g, "")
						// CHANGE: The time unit display in Rspack is second
						.replace(/\d+([.\d]+)?(\s?m?s)/g, "X$1");
				} else {
					actual = stderr.toStringRaw() + actual;
					actual = actual
						.replace(/\u001b\[1m\u001b\[([0-9;]*)m/g, "<CLR=$1,BOLD>")
						.replace(/\u001b\[1m/g, "<CLR=BOLD>")
						.replace(/\u001b\[39m\u001b\[22m/g, "</CLR>")
						.replace(/\u001b\[([0-9;]*)m/g, "<CLR=$1>")
						// CHANGE: The time unit display in Rspack is second
						.replace(/[.0-9]+(<\/CLR>)?(\s?m?s)/g, "X$1$2");
				}
				// cspell:ignore Xdir
				const testPath = path.join(base, testName);
				actual = actual
					.replace(/\r\n?/g, "\n")
					// CHANGE: Remove potential line break and "|" caused by long text
					.replace(/((ERROR|WARNING)([\s\S](?!╭|├))*?)(\n  │ )/g, "$1")
					// CHANGE: Update the regular expression to replace the 'Rspack' version string
					.replace(/Rspack [^ )]+(\)?) compiled/g, "Rspack x.x.x$1 compiled")
					.replace(new RegExp(quoteMeta(testPath), "g"), "Xdir/" + testName)
					.replace(/(\w)\\(\w)/g, "$1/$2")
					.replace(/, additional resolving: X ms/g, "")
					.replace(/Unexpected identifier '.+?'/g, "Unexpected identifier")
					// CHANGE: Replace bundle size, since bundle sizes may differ between platforms
					.replace(/-.*\.js/g, "-xxx.js")
					// CHANGE: Replace bundle size, since bundle sizes may differ between platforms
					.replace(/[0-9]+\.?[0-9]+ KiB/g, "xx KiB")
					.replace(/[0-9]+ bytes/g, "xx bytes");
				expect(actual).toMatchSnapshot();
				// CHANGE: check actual snapshot
				// if (testConfig.validate) testConfig.validate(stats, stderr.toString());
				if (testConfig.validate) testConfig.validate(stats, stderr.toString(), actual);
				done();
			});
		});
	});
});
