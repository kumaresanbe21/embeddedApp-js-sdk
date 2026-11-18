// The system API is intentionally disabled.
//
// var wdk_system = (function () {
//   return {
//     on: function (eventName, callback) {
//       _validateEventName(eventName);
//       if (Object.keys(_widgetLocalEventCallbacks).length >= _MAX_LOCAL_EVENT_CALLBACKS) {
//         throw new Error('Maximum event listeners (' + _MAX_LOCAL_EVENT_CALLBACKS + ') reached'); //NO I18N
//       }
//       var listenerId = _generateWidgetListenerId();
//       if (typeof callback === 'function') { //NO I18N
//         _widgetLocalEventCallbacks[listenerId] = callback;
//       }
//       self.parent.postMessage({
//         type: 'dx_widget_event_request', //NO I18N
//         action: 'app_on', //NO I18N
//         event_name: eventName,
//         listener_id: listenerId,
//         channel: '*',
//         messageId: _widgetEventMsgUID()
//       }, _getParentOrigin());
//       var disposed = false;
//       return function dispose() {
//         if (disposed) { return; }
//         disposed = true;
//         delete _widgetLocalEventCallbacks[listenerId];
//         self.parent.postMessage({
//           type: 'dx_widget_event_request', //NO I18N
//           action: 'app_off', //NO I18N
//           listener_id: listenerId,
//           messageId: _widgetEventMsgUID()
//         }, _getParentOrigin());
//       };
//     },
//     notify: function (eventName, data) {
//       _validateEventName(eventName);
//       var msgId = _widgetEventMsgUID();
//       var promise = new Promise(function (resolve, reject) {
//         _widgetEventData[msgId] = { resolve: resolve, reject: reject };
//         self.parent.postMessage({
//           type: 'dx_widget_event_request', //NO I18N
//           action: 'app_notify', //NO I18N
//           event_name: eventName,
//           data: data,
//           messageId: msgId
//         }, _getParentOrigin());
//       });
//       promise.catch(function (err) { console.error('[WDK] wdk.system.notify failed: ' + (err && err.message || String(err))); }); //NO I18N
//       return promise;
//     }
//   };
// })();
