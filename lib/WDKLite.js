/**
 * wdk_lite.js
 * Lightweight WDK surface exposing only `wdk.user`, `wdk.app`,
 * and route-sync forwarding for widget iframes.
 *
 * Load order:
 *   ZSDK.js -> Initialization.js -> wdk_lite.js
 */
(function (global) {
  'use strict';

  var appSDK;
  var _lastHref = null;

  if (!self._newRequestPromise) {
    var __wdkSDK;

    function __getWdkSDK() {
      if (!__wdkSDK) {
        __wdkSDK = self._getAppSDK();
      }
      return __wdkSDK;
    }

    self._newRequestPromise = function (data, conf) {
      if (data && !data.wdkVersion) {
        data.wdkVersion = '1.0';
      }
      data.sdkVersion = '2.0';
      return __getWdkSDK().getContext().Event.Trigger('ZDK_EVENT', data, true);
    };
  }

  function ZDKResolver(request, conf) {
    request.version = '1.0';
    return self._newRequestPromise(request, conf);
  }

  function validator(value, key, validations) {
    validations = validations || {};
    if ((!validations.required && value !== undefined || validations.required) &&
        !(validations.allow_null && value === null)) {
      if (typeof value !== 'string' && !(value instanceof String)) {
        throw new Error(key + ' must be a String');
      }
      if (!value.trim()) {
        throw new Error(key + ' cannot be blank');
      }
      if (validations.min_length && value.length < validations.min_length) {
        throw new Error(key + ' must be atleast ' + validations.min_length + ' characters');
      }
      if (validations.max_length && value.length > validations.max_length) {
        throw new Error(key + ' must be atmost ' + validations.max_length + ' characters');
      }
    }
  }

  function _getUserProp(prop) {
    var userPromise = ZDKResolver({ action: 'variable', key: 'user' });
    if (userPromise && typeof userPromise.then === 'function') {
      return userPromise.then(function (user) {
        return user && user[prop];
      });
    }
    return userPromise && userPromise[prop];
  }

  async function _onRouteChange() {
    if (location.href === _lastHref) {
      return;
    }
    _lastHref = location.href;
    return wdk_app.notify('history.change', {
      newUrl: location.pathname + location.search + location.hash
    });
  }

  function _startRouteSync() {
    _lastHref = location.href;

    var pushState = history.pushState;
    var replaceState = history.replaceState;

    history.pushState = function () {
      pushState.apply(this, arguments);
      _onRouteChange();
    };

    history.replaceState = function () {
      replaceState.apply(this, arguments);
      _onRouteChange();
    };

    global.addEventListener('popstate', _onRouteChange);
  }

  var wdk_user = {
    get id() { return _getUserProp('id'); },
    get zuid() { return _getUserProp('zuid'); },
    get full_name() { return _getUserProp('full_name'); },
    get first_name() { return _getUserProp('first_name'); },
    get last_name() { return _getUserProp('last_name'); },
    get email() { return _getUserProp('email'); },
    get date_format() { return _getUserProp('date_format'); },
    get role() { return _getUserProp('role'); },
    get profile() { return _getUserProp('profile'); },
    get type() { return _getUserProp('type'); },
    get mode() { return _getUserProp('mode'); }
  };

  var wdk_app = {
    get org() { return ZDKResolver({ action: 'variable', key: 'org' }); },
    get environment() { return ZDKResolver({ action: 'variable', key: 'environment' }); },
    get platform() { return ZDKResolver({ action: 'variable', key: 'platform' }); },
    get deployment() { return ZDKResolver({ action: 'variable', key: 'deployment' }); },

    navigate: function (page, params, target, data) {
      validator(params && params.module || '', 'params.module', { required: true });
      return ZDKResolver({ action: 'route_navigate', page: page, params: params, data: data, target: target });
    },

    on: function (event, callback) {
      if (!event || typeof event !== 'string' || !event.trim()) {
        throw new TypeError('event must be a non-empty string');
      }
      if (typeof callback !== 'function') {
        throw new TypeError('callback must be a Function');
      }

      var rawEvent = event.trim();
      return self._getAppSDK().getContext().Event.Listen(rawEvent, callback);
    },

    notify: function (event, data) {
      if (!event || typeof event !== 'string' || !event.trim()) {
        throw new TypeError('event must be a non-empty string');
      }
      return ZDKResolver({ action: 'app_notify', event: event.trim(), data: data }, { userInput: true });
    }
  };

  function bootstrap() {
    appSDK = self._getAppSDK();
    appSDK.OnLoad(function () {
      _startRouteSync();
    });
  }

  global.wdk = {
    version: '1.0',
    user: wdk_user,
    app: wdk_app,

    /**
     * Invoke a named method on the parent, forwarding any number of arguments.
     * The request is dispatched with action `_APPLY`.
     *
     * @param {string}  methodName - The name of the method to apply.
     * @param {...*}    args       - Any number of arguments to pass to the method.
     * @returns {Promise} Resolves with the parent's response.
     *
     * @example
     * wdk._apply('crm.record.get', 'Leads', '12345');
     * wdk._apply('crm.notify', 'hello', { from: 'widget' }, true);
     */
    _apply: function (methodName) {
      if (!methodName || typeof methodName !== 'string' || !methodName.trim()) {
        throw new TypeError('methodName must be a non-empty string');
      }
      var args = Array.prototype.slice.call(arguments, 1);
      return ZDKResolver({
        action: '_apply',
        methodName: methodName,
        args: args
      });
    }
  };

  bootstrap();

})(typeof self !== 'undefined' ? self : window);
