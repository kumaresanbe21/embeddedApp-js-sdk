(function (global) {
  'use strict';

  var _widgetLocalEventCallbacks = {};
  var _widgetEventData = {};
  var _widgetEventMsgCounter = 0;
  var _widgetListenerIdCounter = 0;
  var _parentOrigin = null;
  var _MAX_NAME_LENGTH = 256;
  var _MAX_LOCAL_EVENT_CALLBACKS = 500;

  function _widgetEventMsgUID() {
    return 'wevt_' + (++_widgetEventMsgCounter) + '_' + Math.random().toString(36).substring(2, 11); //NO I18N
  }

  function _generateWidgetListenerId() {
    return 'wlid_' + (++_widgetListenerIdCounter) + '_' + Math.random().toString(36).substring(2, 11); //NO I18N
  }

  function _getParentOrigin() {
    if (_parentOrigin) { return _parentOrigin; }
    try {
      if (document.referrer) {
        var referrerOrigin = new URL(document.referrer).origin; //NO I18N
        if (referrerOrigin && referrerOrigin !== 'null') { return referrerOrigin; } //NO I18N
      }
    } catch (_) { ; }
    return null;
  }

  function _validateEventName(name) {
    if (!name || typeof name !== 'string' || name.length > _MAX_NAME_LENGTH) { //NO I18N
      throw new Error('Invalid event name: must be a non-empty string of max ' + _MAX_NAME_LENGTH + ' characters'); //NO I18N
    }
  }

  function _validateChannel(channel) {
    if (channel && channel !== '*' && (typeof channel !== 'string' || channel.length > _MAX_NAME_LENGTH)) { //NO I18N
      throw new Error('Invalid channel name: must be a string of max ' + _MAX_NAME_LENGTH + ' characters'); //NO I18N
    }
  }

  function _sendCallbackResponse(responseId, result, success, error) {
    var msg = {
      type: 'dx_event_callback_response', //NO I18N
      responseId: responseId,
      success: success
    };
    if (success) {
      msg.result = result;
    } else {
      msg.error = error;
    }
    self.parent.postMessage(msg, _getParentOrigin());
  }

  function _handleEventCallback(data) {
    var listenerId = data.listenerId;
    var callbackArg = data.callbackArg;
    var responseId = data.responseId;

    if (!_widgetLocalEventCallbacks[listenerId]) {
      _sendCallbackResponse(responseId, undefined, true);
      return;
    }

    var _responded = false;
    var promiseControl = {
      resolve: function (val) {
        if (!_responded) { _responded = true; _sendCallbackResponse(responseId, val, true); }
      },
      reject: function (err) {
        if (!_responded) { _responded = true; _sendCallbackResponse(responseId, undefined, false, err && (err.message || String(err))); }
      }
    };

    try {
      var eventContext = {
        on: wdkEvent.on.bind(wdkEvent),
        trigger: wdkEvent.trigger.bind(wdkEvent)
      };
      var result = _widgetLocalEventCallbacks[listenerId].call(eventContext, callbackArg, promiseControl);
      if (result && typeof result.then === 'function') { //NO I18N
        result.then(function () {
          if (!_responded) { _responded = true; _sendCallbackResponse(responseId, undefined, true); }
        })['catch'](function (err) { //NO I18N
          if (!_responded) { _responded = true; _sendCallbackResponse(responseId, undefined, false, err && (err.message || String(err))); }
        });
      } else if (!_responded) {
        _responded = true;
        _sendCallbackResponse(responseId, undefined, true);
      }
    } catch (error) {
      if (!_responded) { _responded = true; _sendCallbackResponse(responseId, undefined, false, error.message || String(error)); }
    }
  }

  function _handleEventResponse(data) {
    var msgId = data.messageId;
    if (!_widgetEventData[msgId]) { return; }
    if (_widgetEventData[msgId]._timeout) {
      clearTimeout(_widgetEventData[msgId]._timeout);
    }
    if (data.success) {
      _widgetEventData[msgId].resolve(data.data);
    } else {
      _widgetEventData[msgId].reject(data.error);
    }
    delete _widgetEventData[msgId];
  }

  function _handleRemoveListener(data) {
    if (data.listenerId) {
      delete _widgetLocalEventCallbacks[data.listenerId];
    }
  }

  self.addEventListener('message', function (event) { //NO I18N
    if (event.source !== self.parent) { return; }
    if (!_parentOrigin) {
      _parentOrigin = event.origin;
    } else if (event.origin !== _parentOrigin) {
      return;
    }

    var data = event.data;
    if (!data || typeof data !== 'object') { return; } //NO I18N

    switch (data.type) {
      case 'dx_event_callback': //NO I18N
        _handleEventCallback(data);
        break;
      case 'dx_widget_event_response': //NO I18N
        _handleEventResponse(data);
        break;
      case 'dx_event_remove_listener': //NO I18N
        _handleRemoveListener(data);
        break;
    }
  });

  self.addEventListener('pagehide', function () { //NO I18N
    try {
      self.parent.postMessage({
        type: 'dx_widget_unload' //NO I18N
      }, _getParentOrigin() || '*');
    } catch (e) { ; }
  });

  function _createChannelAPI(channel) {
    var api = {
      on: function (eventName, callback) {
        _validateEventName(eventName);
        if (Object.keys(_widgetLocalEventCallbacks).length >= _MAX_LOCAL_EVENT_CALLBACKS) {
          throw new Error('Maximum event listeners (' + _MAX_LOCAL_EVENT_CALLBACKS + ') reached'); //NO I18N
        }
        var listenerId = _generateWidgetListenerId();
        var pendingCallback = typeof callback === 'function' ? callback : null; //NO I18N

        if (pendingCallback) {
          _widgetLocalEventCallbacks[listenerId] = pendingCallback;
        }

        self.parent.postMessage({
          type: 'dx_widget_event_request', //NO I18N
          action: 'event_add_listener', //NO I18N
          event_name: eventName,
          listener_id: listenerId,
          channel: channel,
          messageId: _widgetEventMsgUID()
        }, _getParentOrigin());

        var disposed = false;
        return function dispose() {
          if (disposed) { return; }
          disposed = true;
          delete _widgetLocalEventCallbacks[listenerId];
          self.parent.postMessage({
            type: 'dx_widget_event_request', //NO I18N
            action: 'event_remove_listener', //NO I18N
            listener_id: listenerId,
            messageId: _widgetEventMsgUID()
          }, _getParentOrigin());
        };
      },

      trigger: function (eventName, data) {
        _validateEventName(eventName);
        var msgId = _widgetEventMsgUID();
        var promise = new Promise(function (resolve, reject) {
          _widgetEventData[msgId] = { resolve: resolve, reject: reject };
          self.parent.postMessage({
            type: 'dx_widget_event_request', //NO I18N
            action: 'event_trigger', //NO I18N
            event_name: eventName,
            callback_arg: data,
            channel: channel,
            messageId: msgId
          }, _getParentOrigin());
        });
        promise.catch(function (err) { console.error('[WDK] wdk.event.trigger failed: ' + (err && err.message || String(err))); }); //NO I18N
        return promise;
      }
    };
    return api;
  }

  var globalAPI = _createChannelAPI('*'); //NO I18N
  var channelCache = Object.create(null);
  var wdkEvent = function (channelName) {
    if (!channelName || typeof channelName !== 'string') { //NO I18N
      throw new Error('Channel name must be a non-empty string'); //NO I18N
    }
    _validateChannel(channelName);
    if (!channelCache[channelName]) {
      channelCache[channelName] = _createChannelAPI(channelName);
    }
    return channelCache[channelName];
  };

  wdkEvent.on = globalAPI.on;
  wdkEvent.trigger = globalAPI.trigger;

  global.WDKWidgetEventBridge = {
    data: _widgetEventData,
    messageId: _widgetEventMsgUID,
    parentOrigin: _getParentOrigin,
    validateKey: function (key) {
      if (typeof key !== 'string' || !key.trim()) { //NO I18N
        throw new Error('Invalid key: Key must be a non-empty string.'); //NO I18N
      }
    },
    post: function (message) {
      self.parent.postMessage(message, _getParentOrigin());
    }
  };
  global.WDKWidgetEvent = wdkEvent;
})(typeof self !== 'undefined' ? self : window);
