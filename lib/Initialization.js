var __isInitTriggered = false;
self.WDK_VERSION = "1.0";

(() => {

    let instance;
    let isInitializing = false;
    let readyPromise;

    /**
     * ZSDK.OnLoad only ever remembers a single handler internally - each
     * call to `instance.OnLoad(fn)` silently overwrites the previous one.
     * Since Initialization.js, ZohoCrmHelper.js, WAppHelper.js, etc. each
     * register their own OnLoad callback on the same shared instance, this
     * wraps `OnLoad` (without touching ZSDK.js) so every registered handler
     * is queued and invoked once the real handshake completes - and late
     * registrations (after load already fired) are invoked immediately.
     * @param {ZSDK} zsdkInstance
     * @returns {ZSDK} the same instance, with `OnLoad` patched
     */
    function patchMultiHandlerOnLoad(zsdkInstance) {
        var originalOnLoad = zsdkInstance.OnLoad;
        var queuedHandlers = [];
        var hasRegisteredAggregator = false;
        var hasFired = false;

        zsdkInstance.OnLoad = function(handler) {
            if (typeof handler !== 'function') {
                throw new Error('Invalid Function value is passed');
            }

            if (hasFired) {
                handler.call(zsdkInstance.getContext(), zsdkInstance.getContext());
                return;
            }

            queuedHandlers.push(handler);

            // Only register a single real handler with the underlying ZSDK
            // instance - it aggregates and replays all queued handlers.
            if (!hasRegisteredAggregator) {
                hasRegisteredAggregator = true;
                originalOnLoad.call(zsdkInstance, function() {
                    hasFired = true;
                    var handlersToRun = queuedHandlers;
                    queuedHandlers = [];
                    handlersToRun.forEach(function(fn) {
                        fn.call(zsdkInstance.getContext(), zsdkInstance.getContext());
                    });
                });
            }
        };

        return zsdkInstance;
    }

    /**
     * Creates a new ZSDK instance with proper error handling
     * @returns {ZSDK} The ZSDK instance
     * @throws {Error} If ZSDK class is not loaded
     */
    function createZSDKInstance() {
        if (typeof ZSDK === 'undefined') {
            throw new Error('ZSDK class not loaded. Ensure ZSDK.js is loaded before Initialization.js');
        }
        var zsdkInstance = new ZSDK({
            registrationMeta : {
                wdkVersion : self.WDK_VERSION
            }
        });
        return patchMultiHandlerOnLoad(zsdkInstance);
    }

    /**
     * Initializes the ZSDK instance based on document ready state
     */
    function initializeSDK() {
        if (__isInitTriggered || isInitializing) {
            return;
        }
        
        isInitializing = true;
        __isInitTriggered = true;
        
        try {
            instance = createZSDKInstance();
            var promiseResolve;
            readyPromise = new Promise(function(resolve, reject) {
                promiseResolve = resolve;
            });
            instance.OnLoad(function() {
                promiseResolve();
            });
        } catch (error) {
            __isInitTriggered = false;
            isInitializing = false;
            readyPromise = undefined;
            throw error;
        }
        
        isInitializing = false;
    }

    /**
     * Gets the ZSDK instance, creating it if necessary
     * @returns {ZSDK} The ZSDK instance
     * @throws {Error} If ZSDK cannot be initialized
     */
    function getAppSDK() {
        // If instance doesn't exist and we're not already initializing, create it
        if (!instance && !isInitializing) {
            // Check if ZSDK is available before attempting to create
            if (typeof ZSDK === 'undefined') {
                throw new Error('ZSDK class not loaded. Ensure ZSDK.js is loaded before calling _getAppSDK()');
            }
            initializeSDK();
        }
        
        // If still no instance after initialization attempt, throw error
        if (!instance) {
            throw new Error('ZSDK instance failed to initialize. Please ensure all dependencies are loaded.');
        }
        
        return instance;
    }

    /**
     * Returns a Promise that resolves once the ZSDK instance has completed
     * its real handshake with the parent frame (i.e. ZSDK.OnLoad has fired).
     * Unlike the `__isInitTriggered` flag, this only resolves after init is
     * actually complete, not merely started. Never throws synchronously -
     * initialization failures are surfaced as a rejected Promise.
     * @returns {Promise<void>}
     */
    function onAppReady() {
        try {
            if (!instance && !isInitializing) {
                getAppSDK();
            }
        } catch (error) {
            return Promise.reject(error);
        }

        if (!readyPromise) {
            return Promise.reject(new Error('ZSDK instance failed to initialize. Please ensure all dependencies are loaded.'));
        }

        return readyPromise;
    }

    // Expose _getAppSDK immediately to avoid timing issues
    // This allows other modules to call it even before initialization completes
    self._getAppSDK = getAppSDK;

    // Expose _onAppReady so consumers (e.g. ZRC.js) can await real init
    // completion before triggering requests to the parent frame.
    self._onAppReady = onAppReady;

    // Initialize based on document ready state
    if (typeof document !== 'undefined') {
        initializeSDK();
        // if (document.readyState === 'loading') {
        //     document.addEventListener('DOMContentLoaded', function triggerInit(){
        //         initializeSDK();
        //         document.removeEventListener('DOMContentLoaded', triggerInit);
        //     });
        // } else {
        //     // Document is already loaded, initialize immediately
        //     initializeSDK();
        // }
    } else {
        // No document (Node.js environment), initialize immediately
        initializeSDK();
    }
})();
