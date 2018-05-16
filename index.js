require("aab-utils/headersparser");
require("aab-utils/node");

const
    ContentParser = require("./content"),
    cp = new ContentParser();

module.exports = (...args) => cp.parse( ...args );
