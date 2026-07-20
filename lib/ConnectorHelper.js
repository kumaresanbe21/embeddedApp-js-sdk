(function(){

    let appSDK;

    function newRequestPromise(data) {
        data['wdkVersion'] = self.WDK_VERSION;
        if (!appSDK) {
            try {
                console.log('Getting appSDK from self._getAppSDK');
                appSDK = self._getAppSDK();
                console.log('Got appSDK:', appSDK);
                if (!appSDK) {
                    throw new Error('Failed to get ZSDK instance');
                }
            } catch (error) {
                throw new Error('Connector methods require SDK initialization: ' + error.message);
            }
        }
        console.log('appSDK is:', appSDK);
        console.log('appSDK.getContext is:', appSDK.getContext);
        console.log('appSDK.getContext() is:', appSDK.getContext());
        return appSDK.getContext().Event.Trigger("CRM_EVENT", data, true);
    }

    // file upload issue fie
    function createNewFileObj(file)
    {
        var oldfile = file;
        var newfile = new File([oldfile], oldfile.name, { type: oldfile.type });
        return newfile;
    }

    function constructQueryString(source) {
        var array = [];

        for (var key in source) {
            array.push(encodeURIComponent(key) + "=" + encodeURIComponent(source[key]));
        }
        return array.join("&");
    };

    function remoteCall(method, requestData, type) {
        if(requestData.FILE)
        {
            var newfileobj = createNewFileObj(requestData.FILE.file);
            requestData.FILE.file = newfileobj;
        }
        var reqData = undefined;
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
                throw { Message: "Url missing" }
            }
            if (params) {
                var queryString = constructQueryString(params);
                url += (url.indexOf("?") > -1 ? "&" : "?") + queryString;
            }
            reqData = {
                url: url,
                Header: headers,
                Body: body,
                CONTENT_TYPE: ContentType,
                RESPONSE_TYPE: responseType,
                PARTS: Parts,
                PARTS_BOUNDARY:partBoundary,
                FILE: file
            }
        } else {
            reqData = requestData;
        }

        var data = {
            category: "CONNECTOR", //no i18n
            nameSpace: method,
            data: reqData,
            type:type
        };
        return newRequestPromise(data);
    };

    return {
        ZOHO : Object.assign((self.ZOHO || {}), {
            CRM : Object.assign((self.ZOHO.CRM || {}), {
                /**
                 * @namespace ZOHO.CRM.CONNECTOR
                 */
                CONNECTOR: {
                    /**
                     * @function invokeAPI
                     * @description Invokes Connector API 
                     * @returns {Promise} resolved with response of the Connector API
                     * @memberof ZOHO.CRM.CONNECTOR
                     * @param {String} nameSpace - NameSpace of Connector API to invoke
                     * @param {Object} data - Connector API Data
                     * @param {Object} data.VARIABLES - Dynamic Data represented by placeholders in connectorAPI
                     * @param {Object} data.CONTENT_TYPE - ContentType - multipart for multipart request
                     * @param {Array} data.PARTS - For multipart request provide parts config here
                     * @param {Object} data.FILE - To include a file in your multipart request 
                     * @example
                     * var data = {
                     *      "apikey" : "*********", 
                     *      "First_Name" : "Naresh",  
                     *      "Last_Name" : "Babu", 
                     *      "email" : "naresh.babu@zylker.com"
                     * }
                     * ZOHO.CRM.CONNECTOR.invokeAPI("MailChimp.sendSubscription",data)
                     * .then(function(data){
                     *     console.log(data)
                     * })
                     * @example
                     *  
                     * var data = {
                     *     "CONTENT_TYPE":"multipart",
                     *     "PARTS":[
                     *               {
                     *                   "headers": {  
                     *                       "Content-Type": "application/json"
                     *                   },
                     *                   "content": {"mimeType": "application/vnd.google-apps.folder", "title": "NareshFolder"
                     *                   }
                     *               }
                     *             ]
                     *   }
                     *   ZOHO.CRM.CONNECTOR.invokeAPI("ex10.testconnector.uplaodfile",data)
                     *   .then(function(data){
                     *       console.log(data)
                     *   })
                     * @example
                     * var file = document.getElementById("File").files[0];
                     * var fileType;
                     *   if (file.type === "application/pdf"){
                     *     fileType = file.type;
                     *   }
                     *   else if(file.type === "image/jpeg"){
                     *     fileType = file.type;
                     *   }
                     *   else if(file.type === "text/plain"){
                     *     fileType = "application/msword";
                     *   }
                     *   else if(file.type === ""){
                     *     fileType = "application/msword";
                     *   }
                    
                    *   console.log(file);
                    *   var data = {
                    *     "VARIABLES":{
                    *       "pathFileName" : "/Zoho CRM/myFile/"+file.name
                    *     },
                    *     "CONTENT_TYPE":"multipart",
                    *     "PARTS":[
                    *               {
                    *                 "headers": {  
                    *                   "Content-Type": "application/json"
                    *                 },
                    *                 "content": {"mimeType": fileType,"description": "TestFile to upload", "title":file.name}
                    *               },{
                    *                 "headers": {
                    *                   "Content-Disposition": "file;"
                    *                 },
                    *                 "content": "__FILE__"
                    *               }
                    *             ],
                    *     "FILE":{
                    *       "fileParam":"content",
                    *       "file":file
                    *     },
                    *   }
                    *   console.log(data);
                    *   ZOHO.CRM.CONNECTOR.invokeAPI("ex10.testconnector.uplaodfile",data)
                    *   .then(function(data){
                    *       console.log(data)
                    *   })

                    */
                    invokeAPI: function(nameSpace, data) {
                        return remoteCall(nameSpace, data, "CONNECTOR_API");
                    },
                    
                    /**
                     * @function authorize
                     * @description Prompts the Connector Authorize window  
                     * @returns {Promise} resolved with true on successful Authorization 
                     * @memberof ZOHO.CRM.CONNECTOR
                     * @param {String} nameSpace - NameSpace of Connector to authorize
                     * @example
                     * var connectorName = "zoho.authorize";
                     * ZOHO.CRM.CONNECTOR.authorize(connectorName);
                     *
                     */
                    authorize: function(nameSpace) {
                        return remoteCall(nameSpace, {}, "CONNECTOR_AUTHORIZE");
                    },
                    /**
                     * @function isConnectorAuthorized
                     * @description check the connector is authorized or not.  
                     * @returns {Promise} resolved with true or false
                     * @memberof ZOHO.CRM.CONNECTOR
                     * @param {String} nameSpace - NameSpace of Connector 
                     * @example
                     * var connectorName = "zoho.authorize";
                     * ZOHO.CRM.CONNECTOR.isConnectorAuthorized(connectorName).then(function(result){
                     *  console.log(result) 
                     *});
                        * //prints
                        * true
                        *
                    */
                    isConnectorAuthorized: function(nameSpace) {
                            return remoteCall(nameSpace,{invokeType:"ISAUTHORIZE"}, "CONNECTOR_API");
                    },
                    /**
                     * @function revokeConnector
                     * @description revoke authorized Connector  
                     * @returns {Promise} resolved with response of the Connector revoke
                     * @memberof ZOHO.CRM.CONNECTOR
                     * @param {String} nameSpace - NameSpace of Connector to revoke
                     * @example
                     *   ZOHO.CRM.CONNECTOR.revokeConnector("zoho.accounts")
                     *   .then(function(data){
                     *       console.log(data)
                     *   })
                     *
                     * //prints
                     *{
                     *    "RESULT": "success"
                     * }
                     */
                    revokeConnector: function(nameSpace) {
                        return remoteCall(nameSpace, {}, "CONNECTOR_REVOKE");
                    }
                }
            })
        })
    }
})();