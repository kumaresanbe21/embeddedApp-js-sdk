var __isInitTriggered = false;
self.WDK_VERSION = "1.0";

(() => {

    let instance;
    let isInitializing = false;

    /**
     * Creates a new ZSDK instance with proper error handling
     * @returns {ZSDK} The ZSDK instance
     * @throws {Error} If ZSDK class is not loaded
     */
    function createZSDKInstance() {
        if (typeof ZSDK === 'undefined') {
            throw new Error('ZSDK class not loaded. Ensure ZSDK.js is loaded before Initialization.js');
        }
        return new ZSDK({
            registrationMeta : {
                wdkVersion : self.WDK_VERSION
            }
        });
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
            new Promise(function(resolve, reject) {
                promiseResolve = resolve;
            });
            instance.OnLoad(function() {
                promiseResolve();
            });
        } catch (error) {
            __isInitTriggered = false;
            isInitializing = false;
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

    // Expose _getAppSDK immediately to avoid timing issues
    // This allows other modules to call it even before initialization completes
    self._getAppSDK = getAppSDK;

    // Initialize based on document ready state
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function triggerInit(){
                initializeSDK();
                document.removeEventListener('DOMContentLoaded', triggerInit);
            });
        } else {
            // Document is already loaded, initialize immediately
            initializeSDK();
        }
    } else {
        // No document (Node.js environment), initialize immediately
        initializeSDK();
    }
})();
