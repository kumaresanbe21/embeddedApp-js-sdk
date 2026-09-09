/**Add commentMore actions
 * @typedef {Object} AllowedRequestConfig
 * @property {HeadersInit} [headers]
 * @property {AbortSignal} [signal]
 * @property {"cors" | "no-cors" | "same-origin"} [mode]
 * @property {"default" | "no-store" | "reload" | "no-cache" | "force-cache" | "only-if-cached"} [cache]
 * @property {"no-referrer" | "client" | "no-referrer-when-downgrade" | "origin" | "origin-when-cross-origin" | "same-origin" | "strict-origin" | "strict-origin-when-cross-origin" | "unsafe-url"} [referrerPolicy]
 */

/**
 * Represents the configuration options for a ZRC request.
 *
 * @typedef {Object} ZrcRequestConfig
 * @property {HeadersInit} [headers] - The headers for the request.
 * @property {string} [connection]
 * @property {"json" | "text" | "blob" | "arraybuffer"} [responseType] // stream is not supported in 1.5
 * @property {string} [baseUrl] - The base URL of the request.
 * @property {Record<string, string>} [params] - Query parameters.
 * @property {AbortSignal} [signal]
 * @property {"cors" | "no-cors" | "same-origin"} [mode]
 * @property {"default" | "no-store" | "reload" | "no-cache" | "force-cache" | "only-if-cached"} [cache]
 * @property {"no-referrer" | "client" | "no-referrer-when-downgrade" | "origin" | "origin-when-cross-origin" | "same-origin" | "strict-origin" | "strict-origin-when-cross-origin" | "unsafe-url"} [referrerPolicy]
 */

/**
 * Represents the full config for a ZRC request, including HTTP method and body.
 *
 * @typedef {ZrcRequestConfig & {
 * body?: any,
 * method: string,
 * url?: string,
 * path?: string
 * }} ZrcGenericRequestConfig
 */

/**
 * Represents the response returned by a ZRC request.
 * 
 * @typedef {Object} ZrcResponse
 * @property {number} [status] - The HTTP status code of the response.
 * @property {any} [headers] - The headers of the response.
 * @property {any} [data] - Contains the response body (automatically parsed for JSON data).
 */

/**
 * @typedef {Object} ErrorDetails
 * @property {Error} error - The error object.
 * @property {ZrcRequestConfig & {url: string}} request - The request configuration object.
 * @property {ZrcResponse} response - The response object.
 */

/** 
 * @callback zrc.get
 * @param {string} url url to make call (relative path or absolute url)
 * @param {ZrcRequestConfig} [requestConfig] Optional request configuration
 * @returns {Promise<ZrcResponse>}
*/

/** 
 * @callback zrc.post
 * @param {string} url url to make call (relative path or absolute url)
 * @param {any} [body] request body
 * @param {ZrcRequestConfig} [requestConfig] Optional request configuration
 * @returns {Promise<ZrcResponse>}
*/

/** 
 * @callback zrc.put
 * @param {string} url url to make call (relative path or absolute url)
 * @param {any} [body] request body
 * @param {ZrcRequestConfig} [requestConfig] Optional request configuration
 * @returns {Promise<ZrcResponse>}
*/

/** 
 * @callback zrc.patch
 * @param {string} url url to make call (relative path or absolute url)
 * @param {any} [body] request body
 * @param {ZrcRequestConfig} [requestConfig] Optional request configuration
 * @returns {Promise<ZrcResponse>}
*/

/** 
 * @callback zrc.delete
 * @param {string} url url to make call (relative path or absolute url)
 * @param {ZrcRequestConfig} [requestConfig] Optional request configuration
 * @returns {Promise<ZrcResponse>}
*/

/** 
 * @callback zrc.options
 * @param {string} url url to make call (relative path or absolute url)
 * @param {ZrcRequestConfig} [requestConfig] Optional request configuration
 * @returns {Promise<ZrcResponse>}
*/

/** 
 * @callback zrc.head
 * @param {string} url url to make call (relative path or absolute url)
 * @param {ZrcRequestConfig} [requestConfig] Optional request configuration
 * @returns {Promise<ZrcResponse>}
*/

/** 
 * @callback zrc.request
 * @param {ZrcGenericRequestConfig} [requestConfig] Optional request configuration; provide `url` to call (`path` is also supported, `url` takes precedence if both are given)
 * @returns {Promise<ZrcResponse>}
*/

/** 
 * @callback zrc.createInstance
 * @param {ZrcRequestConfig} [requestConfig] Optional request configuration
 * @returns {CustomZrc}
*/

/**
 * @typedef {Object} ZrcConnectionInstance
 * @property {function(): Promise<boolean>} isAuthorized Returns whether the user-based connection is authorized.
 * @property {function(): Promise<void>} authorize Triggers the authorization flow for the user-based connection.
 */

/**
 * @typedef {Object} ZRC
 * @property {zrc.get} get Makes a GET request.
 * @property {zrc.post} post Makes a POST request.
 * @property {zrc.put} put Makes a PUT request.
 * @property {zrc.patch} patch Makes a PATCH request.
 * @property {zrc.delete} delete Makes a DELETE request.
 * @property {zrc.options} options Makes an OPTIONS request.
 * @property {zrc.head} head Makes a HEAD request.
 * @property {zrc.request} request Makes a custom request.
 * @property {zrc.createInstance} createInstance Creates a new instance of ZRC with custom configuration.
 * @property {{ connection: function(string): ZrcConnectionInstance }} $ Utilities namespace for connection management.
 */

/**
 * @typedef {Object} CustomZrc
 * @property {zrc.get} get Makes a GET request.
 * @property {zrc.post} post Makes a POST request.
 * @property {zrc.put} put Makes a PUT request.
 * @property {zrc.patch} patch Makes a PATCH request.
 * @property {zrc.delete} delete Makes a DELETE request.
 * @property {zrc.options} options Makes an OPTIONS request.
 * @property {zrc.head} head Makes a HEAD request.
 * @property {zrc.request} request Makes a custom request.
 */
(() => {
    let zsdk;
    let currentPageUrl = null;

    /** @type {Record<string, any>} */
    const connectionsCache = {};

    /** @type {boolean | undefined} */
    let _isClientPortalCache;

    function newRequestPromise(data) {
        /*
         * ZRC Sdk Version Maintainance
         */
        data["zrcVersion"] = "1.0";
        data['sdkVersion'] = self.SDK_VERSION;

        if(typeof self._onAppReady !== 'function'){
            console.error(new ZrcError('ZRC methods called before init'));
            return;
        }

        // Wait for the real ZSDK handshake (OnLoad) to complete before
        // triggering any request to the parent frame - not just for the
        // init flag to be set, which happens synchronously at bootstrap.
        return self._onAppReady().then(function() {
            if(!zsdk){
                zsdk = self._getAppSDK();
                // delete self._getAppSDK;
                // delete self.instance;
            }

            return zsdk.getContext().Event.Trigger("CRM_EVENT", data, true);
        });
    }

    /**
     * 
     * @returns {Promise<URL>}
     */
    async function PageUrlResolver() {
        /**
         * @type {URL | string | null}
         */
        let url = null;

        if (currentPageUrl) {
            return currentPageUrl;
        }

        url = await newRequestPromise({ category: "GET_PARENT_URL" });

        if (!url)
            throw new ZrcError(
                "Failed to get current page url for your zrc request"
            );

        currentPageUrl = new URL(url);
        return currentPageUrl;
    };

    /**
     * Converts the json error object into ZRC error instance
     */
    function convertToZrcError(actualError) {
        let error;
        
        // "ZrcError" | "ZrcValidationError" | "ConnectionError" | "ApiError"
        switch (actualError.errorType) {
            case "ConnectionError":
                error = new ConnectionError(actualError.errorMessage ? actualError.errorMessage : "Connection request failed");
                break;
            case "ZrcValidationError":
                error = new ZrcValidationError(actualError.errorMessage);
                break;
            case "ZrcError":
                error = new ZrcError(actualError.errorMessage);
                break;
            case "ApiError":
                error = new ApiError(actualError.errorMessage);
                break;
            case "PermissionException": // error for widgets permissions
                error = new Error(actualError.errorMessage);
                error.code = actualError.errorCode;
                error.detail = actualError.errorDetail;
                error.type = actualError.errorType;
                break;
            default:
                error = new ZrcError(actualError.errorMessage);
                break;
        }

        return error;
    }

    /**
     * 
     * @param {string} url 
     * @param {ZrcRequestConfig & { body?: any, method?: string }} requestConfig 
     * @param {URL | undefined} currentPageUrl 
     * @returns {Promise<ZrcResponse>} API response
     */
	async function ZRCAPIResolver(url, requestConfig = {}, currentPageUrl = undefined) {
		if (!currentPageUrl) {
			currentPageUrl = await PageUrlResolver();
		}
        
        try {
            const zrcRequestData = {
                category: "ZRC_REQUEST",
                url,
                options: {}
            };

            if(requestConfig.body && requestConfig.body instanceof FormData){
                // convert the formdata into json object
                const formDataObj = {};
                for (const [key, value] of requestConfig.body.entries()) {
                    if (value instanceof File) {
                        formDataObj[key] = value;
                    } else {
                        formDataObj[key] = value.toString();
                    }
                }

                requestConfig.body = formDataObj;
                zrcRequestData.options.bodyDataType = "formData"
            }

            zrcRequestData.requestConfig = requestConfig;

            /**
             * @type {Promise<any>}
             */
			let res = newRequestPromise(zrcRequestData);

			return res
				.then(resObj => {
                    return resObj;
				})
				.catch((err) => {
                    if (err && err.errorType && typeof err.errorType === "string"){
                        err = convertToZrcError(err);
                    }

                    if(err.error && err.error.errorType && typeof err.error.errorType === "string"){
                        err.error = convertToZrcError(err.error);
                    }
                    throw err;
				});
		} catch (err) {
			throw err;
		}
	}

	class ZRC {
        #ZRCAPIResolver = ZRCAPIResolver;
        #PageUrlResolver = PageUrlResolver;

        /**
         * @type {ZrcRequestConfig}
         */
        #requestConfig = {
            headers: {},
        };

        /**
         *
         * @param {ZrcRequestConfig | undefined} requestConfig
         */
        constructor(requestConfig) {
            if (requestConfig)
                this.#requestConfig = {
                    ...this.#requestConfig,
                    ...requestConfig,
                };
        }

        /**
         *
         * @param {"GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"} method
         * @param {string} url
         * @param {any} body
         * @param {ZrcRequestConfig | undefined} requestConfig
         * @returns
         */
        async #restCall(method, url, body, requestConfig) {
            // sanitise arguments
            if (requestConfig) {
                delete requestConfig.method;
                delete requestConfig.body;
            }

            // converge body with base config
            if (this.#requestConfig.body) {
                body = body ? body : this.#requestConfig.body;
            }

            // converge config with base config
            requestConfig = { ...this.#requestConfig, ...requestConfig };

            ZrcValidations.validateConfig(url, requestConfig);

            // Validate that methods like GET, OPTIONS, and HEAD do not have a body
            if (
                ["GET", "OPTIONS", "HEAD"].includes(method.toUpperCase()) &&
                body
            ) {
                body = undefined;
            }

            // handle headers type normalization
            if (requestConfig && requestConfig.headers) {
                // Normalize header names to lowercase
                /**
                 * Normalizes the headers in a request configuration object by converting all header keys to lowercase.
                 *
                 * @param {Object} headers - The headers object from the request configuration.
                 * @returns {Record<string, string>} A new object with all header keys converted to lowercase.
                 * @example
                 * const headers = {
                 *   "Content-Type": "application/json",
                 *   "Authorization": "Bearer token"
                 * };
                 * const normalizedHeaders = normalizeHeaders(headers);
                 * console.log(normalizedHeaders);
                 * Output:
                 * {
                 *   "content-type": "application/json",
                 *   "authorization": "Bearer token"
                 * }
                 */
                const normalizedHeaders = Object.keys(requestConfig.headers).reduce((acc, key) => {
                    acc[key.toLowerCase()] = requestConfig.headers[key];
                    return acc;
                }, {});

                requestConfig.headers = normalizedHeaders;
            }

            // handle falsy requestConfig
            if (!requestConfig) {
                requestConfig = {
                    headers: {},
                };
            }

            // add content-type header only for post, put, patch, and delete request automatically
            if (
                method === "POST" ||
                method === "PUT" ||
                method === "PATCH" ||
                method === "DELETE"
            ) {
                if (!requestConfig.headers) {
                    requestConfig.headers = {};
                }

                if (
                    !requestConfig.headers["content-type"] &&
                    body &&
                    (ZrcValidations.isJsonObject(body) ||
                        ZrcValidations.isJsonString(body))
                ) {
                    requestConfig.headers["content-type"] = "application/json";
                }
            }

            // automatically handle "content-type" header for body types FormData, URLSearchParams, Blob, File, ReadableStream
            if (requestConfig && requestConfig.headers) {
                requestConfig.headers = cleanHeaders(
                    requestConfig.headers,
                    body
                );
            }

            // handle JSON body
            if (
                body &&
                requestConfig?.headers &&
                requestConfig.headers["content-type"]
                    ?.trim()
                    .startsWith("application/json")
            ) {
                body = ZrcValidations.isJsonString(body)
                    ? body
                    : ZrcValidations.isJsonObject(body)
                    ? JSON.stringify(body)
                    : body;
            }

            const baseUrl = requestConfig?.baseUrl || this.#requestConfig?.baseUrl || (await this.#PageUrlResolver()).origin;
            const resolvedUrl = ZrcValidations.isRelativePath(url) ? createUrl(url, baseUrl) : new URL(url);

            // handle parameters
            if (
                requestConfig &&
                requestConfig.params &&
                Object.keys(requestConfig.params).length > 0
            ) {
                const searchParams = resolvedUrl.searchParams;
                for (const key in requestConfig.params) {
                    /**
                     * @type {any}
                     */
                    const value = requestConfig.params[key];

                    if (value === null || value === undefined) {
                        continue;
                    }

                    if (Array.isArray(value)) {
                        if (value.length === 0) {
                            continue;
                        }

                        for (const item of value) {
                            if (item !== null && item !== undefined) {
                                const arrKey = `${key}[]`;

                                if (item instanceof Date) {
                                    searchParams.append(
                                        arrKey,
                                        item.toISOString()
                                    );
                                } else if (ZrcValidations.isJsonObject(item)) {
                                    searchParams.append(
                                        arrKey,
                                        JSON.stringify(item)
                                    );
                                } else {
                                    searchParams.append(arrKey, item);
                                }
                            }
                        }
                    } else if (value instanceof Date) {
                        searchParams.append(key, value.toISOString());
                    } else if (ZrcValidations.isJsonObject(value)) {
                        searchParams.append(key, JSON.stringify(value));
                    } else {
                        searchParams.append(key, value);
                    }
                }
            }

            // prepare request config
            /**
             * @type {ZrcRequestConfig & { body?: any, method?: string }}
             */
            const config = { method, ...requestConfig };

            // handle body
            if (body) {
                config.body = body;
            }

            if (method === "GET") {
                delete config.body;
            }

            return this.#ZRCAPIResolver(
                resolvedUrl.toString(),
                config
            );
        }

        /**
         *
         * @param {string} url
         * @param {ZrcRequestConfig | undefined} requestConfig
         */
        get(url, requestConfig) {
            return this.#restCall("GET", url, undefined, requestConfig);
        }

        /**
         *
         * @param {string} url
         * @param {any} body
         * @param {ZrcRequestConfig | undefined} requestConfig
         */
        post(url, body, requestConfig) {
            return this.#restCall("POST", url, body, requestConfig);
        }

        /**
         *
         * @param {string} url
         * @param {any} body
         * @param {ZrcRequestConfig | undefined} requestConfig
         */
        put(url, body, requestConfig) {
            return this.#restCall("PUT", url, body, requestConfig);
        }

        /**
         *
         * @param {string} url
         * @param {any} body
         * @param {ZrcRequestConfig | undefined} requestConfig
         */
        patch(url, body, requestConfig) {
            return this.#restCall("PATCH", url, body, requestConfig);
        }

        /**
         *
         * @param {string} url
         * @param {ZrcRequestConfig | undefined} requestConfig
         */
        delete(url, requestConfig) {
            return this.#restCall("DELETE", url, undefined, requestConfig);
        }

        /**
         *
         * @param {string} url
         * @param {ZrcRequestConfig | undefined} requestConfig
         */
        options(url, requestConfig) {
            return this.#restCall("OPTIONS", url, undefined, requestConfig);
        }

        /**
         *
         * @param {string} url
         * @param {ZrcRequestConfig | undefined} requestConfig
         */
        head(url, requestConfig) {
            return this.#restCall("HEAD", url, undefined, requestConfig);
        }

        /**
         * @param {ZrcGenericRequestConfig} requestConfig
         */
        request(requestConfig) {
            if (!requestConfig || !ZrcValidations.isJsonObject(requestConfig)) {
                throw new ZrcValidationError(
                    "Invalid requestConfig provided for zrc.request method"
                );
            }

            requestConfig.method = requestConfig.method || "GET";
            // `url` takes precedence over `path` when both are provided
            let { path, url, body } = requestConfig;
            url = url || path || "/";
            delete requestConfig.path;
            delete requestConfig.url;
            delete requestConfig.body;

            return this.#restCall(
                requestConfig.method.toUpperCase(),
                url,
                body,
                requestConfig
            );
        }

        /**
         *
         * @param {ZrcRequestConfig} requestConfig
         * @returns {CustomZrc} A custom instance of ZRC
         */
        createInstance(reqConfig) {
            if (!reqConfig || !ZrcValidations.isJsonObject(reqConfig)) {
                throw new ZrcValidationError(
                    "Invalid ZrcRequestConfig provided for zrc.createInstance method"
                );
            }

            // remove method and body from requestConfig
            if (reqConfig) {
                delete reqConfig.method;
                delete reqConfig.body;
            }

            return new CustomZrc(reqConfig);
        }
    }

	class CustomZrc extends ZRC {
		// remove createInstance method from ZRC class
        /**
         * @type {never}
         */
		createInstance() {
			throw new ZrcValidationError("createInstance method is not supported in Custom ZRC object");
		}
	}

	class ZrcValidationError extends Error {
        /**
         * @type {string}
         */
		name;
        /**
         * @type {string}
         */
		message;
        /**
         * @type {string | undefined}
         */
		stack;

        /**
         * @param {string | undefined} message 
         */
		constructor(message) {
			super();
			this.name = "ZRC_VALIDATION_FAILED_ERROR";
			this.message = message ? message : "validation failed with your zrc request";
			delete this.stack;
		}
	}

	class ZrcError extends Error {
        /**
         * @type {string}
         */
		name;
        /**
         * @type {string}
         */
		message;
        /**
         * @type {string | undefined}
         */
		stack;

        /**
         * @param {string | undefined} message 
         */
		constructor(message) {
			super();
			this.name = "ZRC_ERROR";
			this.message = message ? message : `something went wrong while setting up your zrc request`;
			delete this.stack;
		}
	}
    
	class ApiError extends Error {
        /**
         * @type {string}
         */
		name;
        /**
         * @type {string}
         */
		message;
        /**
         * @type {string | undefined}
         */
		stack;

        /**
         * @param {string | undefined} message 
         */
		constructor(message) {
            super();
			this.name = "ZRC_API_ERROR";
			this.message = message ? message : "Your API request has failed";
			delete this.stack;
		}
	}

    class ConnectionError extends Error {
        /**
         * @type {string}
         * 
         */
		name;
        /**
         * @type {string}
         */
		message;
        /**
         * @type {string | undefined}
         */
		stack;

        /**
         * @param {string | undefined} message 
         */
		constructor(message) {
			super();
			this.name = "ZRC_CONNECTION_ERROR";
			this.message = message ? message : "Connection Error";
			delete this.stack;
		}
	}

	class ZrcValidations {
        /**
         * 
         * @param {string} url 
         * @param {ZrcRequestConfig} requestConfig 
         */
		static validateConfig(url, requestConfig = {}) {
			// <--------------------- common validations --------------------->

			// validate url
			if (!url || typeof url !== "string" || url.trim() === "") {
				throw new ZrcValidationError(`Invalid url provided for zrc request: '${url}'`);
			}

			// validate responseType
			if (requestConfig.responseType) ZrcValidations.validateResponseType(requestConfig.responseType);

			// validate allowed requestConfig properties
			ZrcValidations.validateRequestConfigProperties(requestConfig);

			// <--------------------- zrc validations --------------------->

			// validate url
			if (!ZrcValidations.isRelativePath(url)) {

				if (!ZrcValidations.isValidUrl(url)) {
					throw new ZrcValidationError(`Invalid 'url' provided, please provide a relative-path or a valid absolute url for zrc requests: ${url}`);
				}

				// validate baseUrl redundancy
				if (requestConfig.baseUrl) {
					throw new ZrcValidationError(`No need to provide 'baseUrl' when an absolute url is provided. Please remove the baseUrl: ${requestConfig.baseUrl}`);
				}
			} else {
				// baseUrl is required for connection requests
				if (requestConfig.connection && (!requestConfig.baseUrl || typeof requestConfig.baseUrl !== "string" || requestConfig.baseUrl.trim() === "")) {
					throw new ZrcValidationError(`Please provide a valid 'baseUrl' or provide an absolute url for zrc connection requests`);
				}
			}
		}

        /**
         * @param {string} responseType 
         * @returns 
         */
		static validateResponseType(responseType) {
			if (!responseType) return;

			if (!ZrcValidations.isAllowedResponseType(responseType)) {
				throw new ZrcValidationError(`Unsupported responseType: '${responseType}' provided in requestConfig`);
			}

			// validate allowed responseTypes
			switch (responseType) {
				case "blob":
					// removed since mobile apps are failing this check but shouldn't
					break;

				default:
					break;
			}
		}

        /**
         * @param {ZrcRequestConfig} requestConfig 
         * @returns 
         */
		static validateRequestConfigProperties(requestConfig) {
			const allowedProperties = ["connection", "method", "headers", "signal", "mode", "cache", "referrerPolicy", "responseType", "baseUrl", "params"];
			const requestConfigProperties = Object.keys(requestConfig);

			for (const property of requestConfigProperties) {
				if (!allowedProperties.includes(property)) {
					throw new ZrcValidationError(`The property '${property}' is not allowed in requestConfig.`);
				}
			}

			// validate connection property
			if(requestConfig.connection === undefined) {
				return;
			}

			if ((typeof (requestConfig.connection) !== "string" || requestConfig.connection.trim() === "")) {
				throw new ZrcValidationError(`Invalid value provided for property 'connection' in requestConfig: '${requestConfig.connection}'`);
			}

			// validate connection property for restricted headers
			if (requestConfig.connection) {
				// validate request config for connection requests
				// raise error if any restricted headers are provided
				const restrictedHeaders = new Set([
					'authorization',
					'url',
					'connection-details',
					'cookie',
					'connection',
					'waf-encryption-key',
					'waf-encryption-id',
					'zsec_user_import_url',
					'zsec_proxy_server_name',
					'zsec_proxy_server_signature',
					'zsec_proxy_request',
					'zs-systemauthorization',
					'x-http-method-override',
					'x-zcsrf-token',
					'user-agent',
					'remote_user_ip',
								'req-mi-chain',
					'z-signed_remote_user_ip',
					'host'
				]);

				const restrictedPatternsInHeaders = [
					'x-crm-',
					'x-zcsrf',
					'x-zoho',
					'x-zohocrm',
					'lb_'
				];

				for (const header in requestConfig.headers) {
					if (restrictedHeaders.has(header.toLowerCase())) {
						throw new ZrcValidationError(`Header '${header}' is not allowed for connection requests`);
					}

					for (const pattern of restrictedPatternsInHeaders) {
						if (header.toLowerCase().startsWith(pattern)) {
							throw new ZrcValidationError(`Header '${header}' is not allowed for connection requests`);
						}
					}
				}
			}
		}

        /**
         * @param {string} input 
         */
		static isRelativePath(input) {
			try {
				// Reject absolute URLs
				new URL(input);
				return false;
			} catch (error) {
				// Check for valid relative path format
				return !(input.startsWith("http://") || input.startsWith("https://") || !input.startsWith("/"));
			}
		}

        /**
         * @param {string} input 
         */
		static isValidUrl(input) {
			try {
				new URL(input);
				return true;
			} catch (error) {
				return false;
			}
		}

        /**
         * @param {string} responseType 
         */
		static isAllowedResponseType(responseType) {
            return ["json", "text", "blob", "arraybuffer"].includes(responseType); // stream is not supported in 1.5
		}

        /**
         * @param {string} input 
         */
		static isJsonString(input) {
			try {
				JSON.parse(input);
				return true;
			} catch (error) {
				return false;
			}
		}

        /**
         * @param {any} input 
         */
		static isJsonObject(input) {
			if (input === null || typeof input !== "object" || input instanceof FormData || input instanceof Blob || input instanceof ArrayBuffer || input instanceof URLSearchParams) {
				return false;
			}
			try {
				JSON.stringify(input);
				return true;
			} catch (error) {
				return false;
			}
		}

        /**
         * @param {string} url 
         */
		static validateCrmApiVersion(url) {
			// check is if url is a crm path
			if (!url.startsWith("/crm/")) {
				return;
			}

			// handle paths /crm/v7/users
			if (url.startsWith('/crm/v')) {
				const versionStr = url.split('/')[2]; // v7
				const versionNumber = parseInt(versionStr.split('v')[1]);
				if (versionNumber < 7) {
					throw new ZrcValidationError(`zrc only supports v7 and above for CRM requests. Please provide valid version in path: '${url}'`);
				}
			}

			// handle paths /crm/bulk/v7 & /crm/email/v7
			if (url.startsWith('/crm/bulk/v') || url.startsWith('/crm/email/v')) {
				const versionStr = url.split('/')[3];
				const versionNumber = parseInt(versionStr.split('v')[1]);
				if (versionNumber < 7) {
					throw new ZrcValidationError(`zrc only supports v7 and above for CRM requests. Please provide valid version for path: '${url}'`);
				}
			}
		}
	}

	/**
	 * Creates a URL object by appending the relative path to the baseUrl
	 * @param {string} relativePath relative path to be appended to baseUrl
	 * @param {string | undefined} baseUrl base url
	 * @returns {URL} URL object
	 */
	function createUrl(relativePath, baseUrl) {
		// Remove trailing slash from baseUrl if it exists
		if (baseUrl) baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

		// Remove leading slash from path if it exists
		relativePath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

		return baseUrl ? new URL(`${baseUrl}/${relativePath}`) : new URL(relativePath);
	}

	/**
	 * Removes redundant headers from the headers object for body of types FormData, URLSearchParams, Blob, File, ReadableStream
	 * 
	 * fetch will handle this automatically add content-type header for these body types
	 * @param {Record<string, string>} headers headers JSON object
	 * @param {any} body body of the request
	 * @returns cleaned headers
	 */
	function cleanHeaders(headers, body) {
		if (
			body instanceof FormData ||
			body instanceof URLSearchParams ||
			body instanceof Blob ||
			body instanceof File ||
			body instanceof ReadableStream
		) {
			const newHeaders = JSON.parse(JSON.stringify(headers)); // Clone to avoid mutation issues
			delete newHeaders["content-type"];
			return newHeaders;
		}
		return headers; // Return original headers if no modification needed
	}


	// ===================== Connection Auth =====================


	class ZrcConnection {
		/**
		 * @param {string} connectionName
		 */
		constructor(connectionName) {
			if (!connectionName || typeof connectionName !== "string" || connectionName.trim() === "") {
				throw new ZrcValidationError("Please provide a valid connection name");
			}
			this.connectionName = connectionName;
		}

		/**
         * Returns whether the user-based connection is currently authorized.
		 * @returns {Promise<boolean>}
		 */
		async isAuthorized() {
			const connDetails = await getConnectionDetails(this.connectionName, false);

			if (!connDetails.user_based) {
				throw new ConnectionError(`Connection '${this.connectionName}' does not support user-based authorization`);
			}

			return connDetails.authentication?.status;
		}

		/**
         * Triggers the authorization flow for the connection if not already authorized.
		 * @returns {Promise<void>}
		 */
		async authorize() {
			try {
				const connectionDetails = await getConnectionDetails(this.connectionName);

				if (!connectionDetails.user_based) {
					throw new ConnectionError(`Connection '${this.connectionName}' does not support user-based authorization`);
				}

				if (connectionDetails.authentication?.status) {
					return;
				}

				const { api_name, authentication } = connectionDetails;
				const res = await newRequestPromise({ category: "CONNECTION_AUTH", connection: { api_name, authentication } });
				const defaultConnectionErrorMessage = `Failed to authorize the connection: ${this.connectionName}`;
				if (res.error) {
					throw new ConnectionError(res.error.message || defaultConnectionErrorMessage);
				} else if (res.status && res.status !== "success" && res.status !== true) {
					throw new ConnectionError(defaultConnectionErrorMessage);
				}
				return;
			} catch (error) {
				if (error instanceof ConnectionError) throw error;
				throw new ConnectionError(`Failed to authorize the connection: ${this.connectionName}`);
			}
		}
	}

	/**
	 * Fetches connection details for the given connection name.
	 * @param {string} connectionName
	 * @param {boolean} [fromCache=true]
	 * @returns {Promise<object>} connection details
	 */
	async function getConnectionDetails(connectionName, fromCache = true) {
		if (fromCache && connectionsCache[connectionName]) {
			return connectionsCache[connectionName];
		}

		const res = await newRequestPromise({ category: "CONNECTION_DETAILS", connectionName });

		if (res && res.status_code) {
			if (res.status_code === 200) {
				let body = res.response;
				if (typeof body === "string") {
					try { body = JSON.parse(body); } catch (e) { /* use as-is */ }
				}
				if (body && body.connections && body.connections[0]) {
					connectionsCache[connectionName] = body.connections[0];
					return body.connections[0];
				}
			}
			if (res.status_code === 204) {
				throw new ConnectionError(`Connection not found: '${connectionName}'`);
			}
		}
		throw new ConnectionError(`Failed to fetch details for connection: '${connectionName}'`);
	}

	self.zrcConnectionFactory = function (connectionName) {
		return new ZrcConnection(connectionName);
	};


	self.zrcInstance = new ZRC();
	self.ZrcValidationError = ZrcValidationError;
})();

/**
 * @description A library to make HTTP requests
 * @type {ZRC}
*/
const zrc = (() => {

	const instance = self.zrcInstance;
	const ZrcValidationError = self.ZrcValidationError;

	return {

		get(url, requestConfig) {
			return instance.get.call(instance, url, requestConfig);
		},

		post(url, body, requestConfig) {
			return instance.post.call(instance, url, body, requestConfig);
		},

		put(url, body, requestConfig) {
			return instance.put.call(instance, url, body, requestConfig);
		},

		patch(url, body, requestConfig) {
			return instance.patch.call(instance, url, body, requestConfig);
		},

		delete(url, requestConfig) {
			return instance.delete.call(instance, url, requestConfig);
		},

		options(url, requestConfig) {
			return instance.options.call(instance, url, requestConfig);
		},

		head(url, requestConfig) {
			return instance.head.call(instance, url, requestConfig);
		},

		request(requestConfig) {
			return instance.request.call(instance, requestConfig);
		},

		createInstance(requestConfig) {
			if (!requestConfig) {
				throw new ZrcValidationError("requestConfig is required for zrc.createInstance method");
			}

			return instance.createInstance.call(instance, requestConfig);
		},

		/**
		 * @description Utilities namespace for connection management
		 * @namespace zrc.$
		 */
		$: {
			/**
			 * @function
			 * @description Get a Connection object to check authorization and authorize user-based connections
			 * @param {string} connectionName - Name of the connection
			 * @returns {ZrcConnectionInstance} - Returns a Connection object with isAuthorized() and authorize() methods
			 * @memberof zrc.$
			 * @example
			 * const conn = zrc.$.connection("my_connection");
			 * if (!(await conn.isAuthorized())) {
			 *   await conn.authorize();
			 * }
			 */
			connection(connectionName) {
				return self.zrcConnectionFactory(connectionName);
			}
		}
	}
})();

// Expose zrc globally
if (typeof self !== 'undefined') {
	self.zrc = zrc;
} else if (typeof window !== 'undefined') {
	window.zrc = zrc;
}