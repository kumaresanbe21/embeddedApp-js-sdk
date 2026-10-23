(function (global) {
    var appSDK;

    function getAppSDK() {
        if (!appSDK) {
            try {
                appSDK = self._getAppSDK();
            } catch (error) {
                throw new Error('Platform helper methods require SDK initialization: ' + error.message);
            }
            if (!appSDK) {
                throw new Error('Platform helper methods require SDK initialization');
            }
        }
        return appSDK;
    }

    function newRequestPromise(data) {
        data.sdkVersion = self.SDK_VERSION;
        data.wdkVersion = self.WDK_VERSION;
        return getAppSDK().getContext().Event.Trigger('CRM_EVENT', data, true);
    }

    function manipulateUI(data) {
        data.category = 'UI';
        return newRequestPromise(data);
    }

    function createNewFileObj(file) {
        var oldfile = file;
        var newfile = new File([oldfile], oldfile.name, { type: oldfile.type });
        return newfile;
    }

    function constructQueryString(source) {
        var array = [];

        for (var key in source) {
            array.push(encodeURIComponent(key) + '=' + encodeURIComponent(source[key]));
        }
        return array.join('&');
    }

    function remoteCall(method, requestData, type) {
        if (requestData.FILE) {
            var newfileobj = createNewFileObj(requestData.FILE.file);
            requestData.FILE.file = newfileobj;
        }

        var reqData;
        if (!type) {
            var url = requestData.url;
            var params = requestData.params;
            var headers = requestData.headers;
            var body = requestData.body;
            var Parts = requestData.PARTS;
            var partBoundary = requestData.PART_BOUNDARY;
            var ContentType = requestData.CONTENT_TYPE;
            var responseType = requestData.RESPONSE_TYPE;
            var file = requestData.FILE;

            if (!url) {
                throw { Message: 'Url missing' };
            }

            if (params) {
                var queryString = constructQueryString(params);
                url += (url.indexOf('?') > -1 ? '&' : '?') + queryString;
            }

            reqData = {
                url: url,
                Header: headers,
                Body: body,
                CONTENT_TYPE: ContentType,
                RESPONSE_TYPE: responseType,
                PARTS: Parts,
                PARTS_BOUNDARY: partBoundary,
                FILE: file
            };
        } else {
            reqData = requestData;
        }

        var data = {
            category: 'CONNECTOR',
            nameSpace: method,
            data: reqData,
            type: type
        };

        return newRequestPromise(data);
    }

    var connector = {
        invokeAPI: function (nameSpace, data) {
            return remoteCall(nameSpace, data, 'CONNECTOR_API');
        },

        authorize: function (nameSpace) {
            return remoteCall(nameSpace, {}, 'CONNECTOR_AUTHORIZE');
        },

        isConnectorAuthorized: function (nameSpace) {
            return remoteCall(nameSpace, { invokeType: 'ISAUTHORIZE' }, 'CONNECTOR_API');
        },

        revokeConnector: function (nameSpace) {
            return remoteCall(nameSpace, {}, 'CONNECTOR_REVOKE');
        }
    };

    var dialer = {
        maximize: function () {
            return manipulateUI({
                action: {
                    telephony: 'MAXIMIZE'
                }
            });
        },

        minimize: function () {
            return manipulateUI({
                action: {
                    telephony: 'MINIMIZE'
                }
            });
        },

        notify: function () {
            return manipulateUI({
                action: {
                    telephony: 'NOTIFY'
                }
            });
        }
    };

    var wdk = global.wdk || {};

    Object.defineProperty(wdk, 'connector', {
        value: connector,
        writable: false,
        enumerable: true,
        configurable: true
    });

    Object.defineProperty(wdk, 'dialer', {
        value: dialer,
        writable: false,
        enumerable: true,
        configurable: true
    });

    global.wdk = wdk;
})(typeof self !== 'undefined' ? self : window);
