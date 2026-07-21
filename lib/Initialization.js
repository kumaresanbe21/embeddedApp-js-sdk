var __isInitTriggered = false;
self.WDK_VERSION = "1.0";

// Self-invoked function for scope isolation (like old flow)
// But NO initialization code executes - only when _getAppSDK() is called
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
     * Initializes the ZSDK instance lazily
     * Message listener is already set up by ZSDKBootstrap() when ZSDK.js loads
     * This function just creates the ZSDK instance on first call
     */
    function initializeSDK() {
        if (__isInitTriggered || isInitializing) {
            return;
        }
        
        isInitializing = true;
        __isInitTriggered = true;
        
        try {
            instance = createZSDKInstance();
        } catch (error) {
            __isInitTriggered = false;
            isInitializing = false;
            throw error;
        }
        
        isInitializing = false;
    }

    /**
     * Gets the ZSDK instance, creating it if necessary
     * Lazy initialization: only creates ZSDK when first called
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
     * Expose _getAppSDK immediately
     * This allows other modules to call it when needed
     * Lazy initialization ensures listeners are registered before SDK creation
     */
    self._getAppSDK = getAppSDK;

})();
