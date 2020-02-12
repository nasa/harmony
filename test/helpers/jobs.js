const uuid = require('uuid');

// Example jobs to use in tests
const woodyJob1 = {
  username: 'woody',
  requestId: uuid().toString(),
  status: 'successful',
  message: 'Completed successfully',
  progress: 100,
  links: [{ href: 'http://example.com/woody1' }],
};

const woodyJob2 = {
  username: 'woody',
  requestId: uuid().toString(),
  status: 'running',
  message: 'In progress',
  progress: 60,
  links: [],
};

const buzzJob1 = {
  username: 'buzz',
  requestId: uuid().toString(),
  status: 'running',
  message: 'In progress',
  progress: 30,
  links: [],
};

/**
 * Returns true if the object is found in the passed in list
 *
 * @param {Object} obj The object to search for
 * @param {Array} list An array objects
 * @returns {Boolean} true if the object is found
 */
function contains(obj, list) {
  list.forEach((element) => {
    if (element === obj) {
      return true;
    }
    return false;
  });
}

module.exports = { woodyJob1, woodyJob2, buzzJob1, contains };
