const { handleApiRequest } = require('../lib/router');

module.exports = async (req, res) => {
  return handleApiRequest(req, res);
};
