(function (global) {
  'use strict';

  var bridge = global.WDKWidgetEventBridge;
  if (!bridge) {
    throw new Error('Store.js requires Event.js to be loaded first.');
  }

  var supportedTypesHint = 'Supported types: string, number, boolean, null, plain objects, and arrays.'; //NO I18N

  function validateValue(value, context, seen) {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === 'function') { //NO I18N
      throw new Error('Cannot store function in ' + context + '. ' + supportedTypesHint); //NO I18N
    }
    if (typeof value === 'symbol') { //NO I18N
      throw new Error('Cannot store symbol in ' + context + '. ' + supportedTypesHint); //NO I18N
    }
    if (typeof value === 'bigint') { //NO I18N
      throw new Error('Cannot store BigInt in ' + context + '. ' + supportedTypesHint); //NO I18N
    }
    if (typeof value === 'object') { //NO I18N
      if (!seen) { seen = new Set(); }
      if (seen.has(value)) {
        throw new Error('Cannot store circular reference in ' + context + '. ' + supportedTypesHint); //NO I18N
      }
      if (seen.size > 5000) { return; } //NO I18N
      seen.add(value);
      if (value instanceof Promise || (value && typeof value.then === 'function' && typeof value.catch === 'function')) { //NO I18N
        throw new Error('Cannot store Promise in ' + context + '. ' + supportedTypesHint); //NO I18N
      }
      if (value instanceof Date) {
        throw new Error('Cannot store Date object in ' + context + '. Use date.toISOString() or date.getTime().'); //NO I18N
      }
      if (value instanceof RegExp) {
        throw new Error('Cannot store RegExp in ' + context + '. ' + supportedTypesHint); //NO I18N
      }
      if (value instanceof Error) {
        throw new Error('Cannot store Error object in ' + context + '. ' + supportedTypesHint); //NO I18N
      }
      if (typeof Map !== 'undefined' && value instanceof Map) { //NO I18N
        throw new Error('Cannot store Map in ' + context + '. ' + supportedTypesHint); //NO I18N
      }
      if (typeof Set !== 'undefined' && value instanceof Set) { //NO I18N
        throw new Error('Cannot store Set in ' + context + '. ' + supportedTypesHint); //NO I18N
      }
      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) {
          validateValue(value[i], context + '[' + i + ']', seen);
        }
        seen.delete(value);
        return;
      }
      for (var key in value) {
        if (value.hasOwnProperty(key)) {
          validateValue(value[key], context + '.' + key, seen);
        }
      }
      seen.delete(value);
    }
  }

  function request(action, data) {
    var messageId = bridge.messageId();
    return new Promise(function (resolve, reject) {
      bridge.data[messageId] = { resolve: resolve, reject: reject };
      bridge.post({
        type: 'dx_widget_store_request', //NO I18N
        action: action,
        data: data,
        messageId: messageId
      });
    });
  }

  function createBucketAPI(bucketName) {
    return {
      get: function (key) {
        bridge.validateKey(key);
        return request('store_get', { key: key, options: { bucket: bucketName } });
      },
      set: function (key, value) {
        bridge.validateKey(key);
        validateValue(value, 'store'); //NO I18N
        return request('store_set', { key: key, value: value, options: { bucket: bucketName } });
      },
      remove: function (key) {
        bridge.validateKey(key);
        return request('store_remove', { key: key, options: { bucket: bucketName } });
      },
      clear: function () {
        return request('store_clear', { options: { bucket: bucketName } });
      }
    };
  }

  var wdkStore = function (bucketName) {
    if (!bucketName || typeof bucketName !== 'string' || !bucketName.trim()) { //NO I18N
      throw new Error('Bucket name must be a non-empty string'); //NO I18N
    }
    if (bucketName.indexOf(':') !== -1) {
      throw new Error('Bucket name must not contain a colon (:)'); //NO I18N
    }
    return createBucketAPI(bucketName);
  };

  wdkStore.get = function (key) {
    bridge.validateKey(key);
    return request('store_get', { key: key, options: {} });
  };

  wdkStore.set = function (key, value) {
    bridge.validateKey(key);
    validateValue(value, 'store'); //NO I18N
    return request('store_set', { key: key, value: value, options: {} });
  };

  wdkStore.remove = function (key) {
    bridge.validateKey(key);
    return request('store_remove', { key: key, options: {} });
  };

  global.WDKWidgetStore = wdkStore;
})(typeof self !== 'undefined' ? self : window);
