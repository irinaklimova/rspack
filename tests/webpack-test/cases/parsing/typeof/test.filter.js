const { FilteredStatus } = require("../../../lib/util/filterUtil");

module.exports = () => [
	FilteredStatus.PARTIAL_PASS,
	"require.include",
	"support amd"
];
