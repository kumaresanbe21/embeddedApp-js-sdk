/**
 * WDK.js — Widget Developer Kit 1.0
 *
 * JavaScript implementation of the ZDK 2.0 API (from ZDK-2.0.ts) with:
 *   • `wdk` prefix instead of `zdk`
 *   • Widget-iframe resolver setup (ZDK_EVENT via appSDK)
 *   • Falls back to the existing CScript _newRequestPromise when in CScript context
 *   • Adds widget-specific APIs not in ZDK-2.0.ts:
 *       wdk.app.on(event, fn)    — PageLoad / event listener
 *       wdk.client.*         — browser utility helpers
 *
 * Load order (required in widget HTML):
 *   Single bundle: WDK.min.js  (contains ZSDK + Initialization + WDK, auto-inits)
 *   Standalone helpers: PlatformHelper.min.js
 *
 *   If loading separately: ZSDK.js -> Initialization.js -> WDK.js
 */
(function (global) {
  'use strict';

  // ── 1. Widget-iframe resolver bootstrap ─────────────────────────────────────
  var __wdkSDK;
  function __getWdkSDK() {
    if (!__wdkSDK) { __wdkSDK = self._getAppSDK(); }
    return __wdkSDK;
  }
  function _newRequestPromise(data) {
    if (data && !data.wdkVersion) { data.wdkVersion = '1.0'; }
    return __getWdkSDK().getContext().Event.Trigger('ZDK_EVENT', data, true);
  }

  // ── Backward Compatibility Layer (isolated for easy removal) ────────────────
  // Remove this whole object and replace call-sites with direct ZDKResolver calls
  // once legacy handlers are aligned to ZDK 2.0 action names.
  var WDKCompat = {
    actionMapping: {
      'open_popup': 'open_widget_by_id',
      'open_mailer': 'send_mail'
    },

    remapRequest: function (request) {
      if (request.action === 'open_popup') {
        // ZDK-2.0: { id, type, api_name, crux, config, data }
        // ZDK-1.0: { id, type, api_name, data, config{..., crux} }
        var newConfig = request.config || {};
        if (request.crux) { newConfig.crux = request.crux; }
        request.config = newConfig;
      }

      if (request.action === 'open_mailer') {
        // ZDK-2.0: { action: 'open_mailer', mail_config }
        // ZDK-1.0: { action: 'send_mail', config }
        request.config = request.mail_config;
        delete request.mail_config;
      }

      if (this.actionMapping[request.action]) {
        request.action = this.actionMapping[request.action];
      }
      return request;
    },

    popupClose: function (closeConfig, response) {
      var p = ZDKResolver({ action: 'close_popup', config: closeConfig, response: response });
      if (p && typeof p.then === 'function') {
        return p.catch(function () {
          return ZDKResolver({ action: 'close_widget', config: closeConfig, response: response });
        });
      }
      return p;
    },

    flyoutOpen: function (name, widget, config, data) {
      var type = widget && widget.type;
      config.max_height = "100%";
      config.max_width = "100%";
      var createProm = ZDKResolver({ action: 'create_flyout', name: name, config: config || {} });
      var openReq = function () {
        return ZDKResolver({ action: 'open_flyout', name: name, id: widget && widget.id, type: type, api_name: widget && widget.api_name, config: config || {}, data: data });
      };
      if (createProm && typeof createProm.then === 'function') {
        return createProm.then(function () { return openReq(); });
      }
      return openReq();
    },

    clientOpenURL: function (url, target) {
      return ZDKResolver({ action: 'open_window', url: url, target: target || '_blank', version: '1.0' });
    }
  };

  // ── 2. Resolvers (same pattern as ZDK-2.0.ts) ────────────────────────────────

  // Keep the generated SDK surface thin: WDK is now a wrapper for the underlying CRM
  // request bridge. The authoritative validation should be enforced in CRM before side
  // effects are executed. This preserves compatibility while reducing the amount of
  // behavior embedded in the browser bundle.
  function ZDKResolver(request, conf) {
    request = request || {};
    request.version = '1.0';
    WDKCompat.remapRequest(request);
    return _newRequestPromise(request, conf);
  }

  var ZDK1Resolver = ZDKResolver;

  function ZDKAPIResolver(request) {
    var version = (typeof wdk !== 'undefined' && wdk.Apps && wdk.Apps.CRM)
      ? wdk.Apps.CRM.version
      : undefined;
    return ZDKResolver({ action: 'api_dispatch', data: request, version: version });
  }

  // ── 2a. Route-sync (forward SPA navigation inside the widget to the host) ───
  //
  // Wraps pushState/replaceState (browsers emit no event for these — wrapping
  // is the only way) and listens for popstate (back/forward), forwarding every
  // route change to the parent via a `history_change` request.

  var appSDK;
  var _lastHref = null;

  function _onRouteChange() {
    if (location.href === _lastHref) {
      return;
    }
    _lastHref = location.href;
    return ZDKResolver({
      action: 'history_change',
      data: {
        newUrl: location.pathname + location.search + location.hash
      }
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

  // ── 3. window proxy (same as ZDK-2.0.ts) ────────────────────────────────────
  //  Provides self.window.sessionStorage and self.window.open for worker (CScript)
  //  contexts where no real `window` object exists.
  //  In a browser widget iframe self.window === window (read-only properties) —
  //  we must NOT attempt to overwrite it.

  if (!self.window) {
    // CScript / Web Worker context only — safe to create a full proxy object.
    self.window = {
      open: function (url, target) {
        if (!url || !url.trim()) { throw new Error('URL cannot be empty'); }
        if (target && target !== '_self' && target !== '_blank') {
          throw new Error("target must be either '_self' or '_blank'");
        }
        return ZDKResolver({ action: 'open_window', url: url, target: target });
      }
    };
  }

  // ── 4. Internal validator (from ZDK-2.0.ts) ──────────────────────────────────

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

  // ── 5. Helper classes (Field, Subform, etc. — from ZDK-2.0.ts, translated) ──
  //  Used by wdk.components.record_form / record_detail / record_list.
  //  In CScript context they work natively; in widget iframe they resolve
  //  asynchronously (ZDK_EVENT backs the resolver).

  class IUploadFieldSourceOptions {
    constructor(apiName, source) { this.apiName = apiName; this.source = source; }
  }

  class IWorkdriveSourceOptions extends IUploadFieldSourceOptions {
    set folderId(folder_id) {
      return ZDKResolver({ action: 'field_set_folder_id', field_name: this.apiName, value: folder_id, source: this.source });
    }
  }

  class IUploadFieldOptions {
    #apiName;
    constructor(apiName) {
      this.#apiName = apiName;
      this.workDrive = new IWorkdriveSourceOptions(apiName, 'workdrive');
    }
    get allowedSources() { return ZDKResolver({ action: 'field_read',  field_name: this.#apiName }); }
    set allowedSources(v) { return ZDKResolver({ action: 'field_write', field_name: this.#apiName, value: v }); }
  }

  class IFieldConfigurator {
    #apiName;
    constructor(apiName) { this.#apiName = apiName; this.fileUpload = new IUploadFieldOptions(apiName); }
  }

  class IteratorResult {
    constructor(value, done) { this._value = value; this._done = done; }
    get value() { return this._value; }
    set value(v) { this._value = v; }
    get done() { return this._done; }
    set done(v) { this._done = v; }
  }

  class Iterator {
    constructor(api_name, filter, limit, offset) {
      this.unique_key = Math.floor(10000000 + Math.random() * 90000000);
      this.api_name = api_name; this.filter = filter;
      this.limit = limit; this.offset = offset; this.current_index = 0;
    }
    next() {
      var nv = ZDKResolver({ action: 'field_iterator', api_name: this.api_name, subform_details: this.subform_details, unique_key: this.unique_key, current_index: this.current_index, filter: this.filter, limit: this.limit, offset: this.offset });
      this.current_index++;
      return new IteratorResult(nv.value, nv.done);
    }
    reset() { return new Iterator(this.api_name, this.subform_details, this.filter, this.limit, this.offset); }
  }

  /**
   * Class representing a Field in a form/list/detail page.
   * @category Objects
   */
  class Field {
    static className = 'Field';
    #apiName; #selector; #resolver;
    constructor(apiName, selector, resolver) {
      this.#apiName = apiName; this.#selector = selector; this.#resolver = resolver || ZDKResolver;
    }
    /**
     * @summary Get the API name of field
     * @function
     * @memberof Field
     * @returns {Promise} api_name
     * @example <caption>Sample</caption>
     * wdk.components.record_form.field('Email').getApiName();
     * @example <caption>Output</caption>
     * Email
     */
    getApiName() { return this.#apiName; }
    #sel(extra) { return Object.assign({ field_name: this.#apiName, ...(this.#selector ? { selector: this.#selector } : {}) }, extra || {}); }
    /**
     * @summary Mask the field value
     * @function
     * @memberof Field
     * @example <caption>Sample 1</caption>
     * wdk.components.record_form.field('Email').mask({character: '*', length: 4, reverse: false});
     * @example <caption>Sample 2</caption>
     * wdk.components.record_form.field('Email').mask({character: '#', length: 8, reverse: true});
     * @example <caption>Output</caption>
     * ****rt@zohomail.com
     * @example <caption>Output</caption>
     * robert@zoho########
     */
    mask(config) {
      if (!config.length || config.length < 1) { throw new Error('invalid length - ' + config.length); }
      return this.#resolver({ action: 'field_mask', ...this.#sel(), config });
    }
    /**
     * @summary Show inline error message for an input field. In canvas detail page, supported only in Ajax edit and Mandatory form.
     * @function
     * @memberof Field
     * @param {String} message - Text to be displayed
     * @example <caption>Sample</caption>
     * wdk.components.record_form.field('Email').error('Invalid value');
     * @example <caption>Clear error</caption>
     * wdk.components.record_form.field('Email').error(null);
     */
    error(message) {
      if (message === null || typeof message === 'string' || message instanceof String) { return this.#resolver({ action: 'field_set_error', ...this.#sel(), value: message }); }
      throw new TypeError('First argument must be a String or null');
    }
    /**
     * @summary Set the value for a field. In Canvas/Standard Detail pages, this is supported only in Mandatory form
     * @function
     * @memberof Field
     * @param {String|Number|Boolean|Object} value - Value for the field
     * @example <caption>Sample</caption>
     * wdk.components.record_form.field('Custom_Field1').setValue('Value');
     * @example <caption>For Lookup fields</caption>
     * wdk.components.record_form.field('Account_Name').setValue({id: '5164254000000366162', name: 'John Doe'});
     * @example <caption>For Checkbox fields</caption>
     * wdk.components.record_form.field(('Email_Opt_Out').setValue(true); // true/false -> enable/disable
     * @example <caption>For Subform fields</caption>
     * wdk.components.record_form.field(('Subform_1').setValue( [ {
     * Name_1: 'John Doe',
     * Email_1: 'john@zylker.com',
     * Website_1: 'www.johnzylker.com'
     * } ] );
     */
    setValue(value)  { return this.#resolver({ action: 'field_write',        ...this.#sel(), value }); }
    /**
     * @summary Get the value of a field
     * @function
     * @memberof Field
     * @returns {String|Number|Boolean|Object} Value of the field
     * @example <caption>Sample</caption>
     * var field_obj = wdk.components.record_form.field('Custom_Field1');
     * field_obj.getValue();
     * @example <caption>For Lookup fields</caption>
     * var lookup_field = wdk.components.record_form.field('Account_Name');
     * lookup_field.getValue();
     * @example <caption>For Subform fields</caption>
     * var subform_field =  wdk.components.record_form.field('Subform_1');
     * subform_field.getValue();
     * @example <caption>Output</caption>
     * zylker@zylkergp.com
     * @example <caption>Output</caption>
     * {id: '5164254000000366162', name: 'John Doe'}
     * @example <caption>Output</caption>
     * [{
     * Name_1: 'John Doe',
     * Email_1: 'john@zylker.com',
     * Website_1: 'www.johnzylker.com'
     * }]
     */
    getValue()       { return this.#resolver({ action: 'field_read',         ...this.#sel() }); }
    /**
     * @summary Set the mandatory attribute for the input field
     * @function
     * @memberof Field
     * @param {Boolean} value - mandatory attribute of the field input(true/false)
     * @example <caption>Sample</caption>
     * wdk.components.record_form.field('Custom_Field1').mandate(true);
     */
    mandate(value)   { return this.#resolver({ action: 'field_set_required', ...this.#sel(), value }); }
    /**
     * @summary Set the max Length of field input
     * @function
     * @memberof Field
     * @param {Number} value - max length of the field input
     * @example <caption>Sample</caption>
     * wdk.components.record_form.field('Custom_Field1').maxlength(10);
     */
    maxlength(value) { return this.#resolver({ action: 'field_set_max_length', ...this.#sel(), value }); }
    /**
     * @summary Locks or unlocks the field to prevent user edits.
     * @function
     * @memberof Field
     * @param {Boolean} value - readonly attribute of the field input(true/false)
     * @example <caption>Sample</caption>
     * wdk.components.record_form.field('Custom_Field1').lock(true);
     */
    lock(value)      { return this.#resolver({ action: 'field_set_read_only', ...this.#sel(), value }); }
    /**
     * @summary Shows or hides the field.
     * @function
     * @memberof Field
     * @param {Boolean} value - visibility attribute of the field input(true/false)
     * @example <caption>Sample</caption>
     * wdk.components.record_form.field('Custom_Field1').display(true);
     */
    display(value)   { return this.#resolver({ action: 'field_visibility',   ...this.#sel(), value }); }
    /**
     * @summary Show highlighted message on field
     * @function
     * @memberof Field
     * @param {Object} style_config - style_config to be added to the field
     * @param {'#FF0000'} style_config.backgroundColor - sets the background color of an element.
     * @param {'#FF0000'} style_config.foregroundColor - sets the foreground color value of an element's text
     * @param {'#FF0000'} style_config.borderColor - sets the color of an element's border.
     * @param {'bold'|'100'|'inherit'} style_config.fontWeight - sets the thickness (weight) of the text's character.
     * @example <caption>Sample</caption>
     * var field_obj = wdk.components.record_form.field('Custom_Field1')..style({ backgroundColor: '#ff0000', foregroundColor: '#fff000', borderColor: '#ffff00' });
     */
    style(style_config) {
      for (var c in style_config) {
        if (!style_config[c] || typeof style_config[c] === 'string' && !style_config[c].trim()) { throw new Error(c + ' cannot be empty'); }
      }
      return this.#resolver({ action: 'field_style_add', ...this.#sel(), style_config });
    }
    /**
     * @summary Set the info icon to field
     * @function
     * @memberof Field
     * @param {String} message - message/info to be added
     * @example <caption>Sample</caption>
     * var field_obj = wdk.components.record_form.field('Custom_Field1').info('Shows custom info');
     */
    info(message) {
      validator(message, 'message', { min_length: 1, max_length: 255, required: true });
      return this.#resolver({ action: 'field_info_add', ...this.#sel(), message });
    }
    /**
     * @summary Sets a tooltip for the field.
     * @function
     * @memberof Field
     * @param {String} message - message to be added
     * @example <caption>Sample</caption>
     * var field_obj = wdk.components.record_form.field('Custom_Field1').tooltip('Shows custom info');
     */
    tooltip(message) {
      validator(message, 'message', { min_length: 1, max_length: 180, required: true });
      return this.#resolver({ action: 'field_tooltip_add', ...this.#sel(), message });
    }
    /**
     * @summary Set the criteria for lookup/picklist fields
     * @function
     * @memberof Field
     * @param {String} criteria - criteria for filtering lookup records
     * @param {Object} [config] - config for lookup field criteria
     * @example <caption>Lookup supports a maximum of five criteria, each using the starts_with and equals operators. The 'id' field supports the in operator.</caption>
     * wdk.components.record_form.field('Custom_Lookup1').criteria("((Last_Name:equals:Burns)and(First_Name:starts_with:M))", {filterOnSearch: true});
     * @example <caption>Picklist supports a maximum of five criteria, each using the starts_with, equals, ends_with, contains, not_equals and in operators.</caption>
     * wdk.components.record_form.field('CFPicklist').criteria("((id:in:12111113441,12111113443))");
     * @example <caption>Picklist sample with value</caption>
     * wdk.components.record_form.field('CFPicklist').criteria("(actual_value:starts_with:Industry)");
     * @example <caption>Date field range supports only one criterion with between operator.</caption>
     * wdk.components.record_form.field('Date_1').criteria("(value:between:2023-04-18,2023-04-25)");
     */
    criteria(criteria, config) { return this.#resolver({ action: 'field_set_criteria', ...this.#sel(), criteria, config }); }
    /**
     * @summary Bulk-set multiple field properties in one call
     * @function
     * @param {Object} config - Property map for field configuration
     * @param {Boolean} [config.mandate] - Set mandatory attribute
     * @param {Boolean} [config.lock] - Lock/Unlock the field
     * @param {Boolean} [config.display] - Set visibility (show/hide)
     * @param {Number} [config.maxlength] - Set maximum length
     * @param {String} [config.criteria] - Set filter criteria
     * @returns {Promise} Result of config operation
     * @example <caption>Sample</caption>
     * wdk.components.record_form.field('Email').config({ mandate: true, lock: false, display: true, maxlength: 100 });
     */
    // config(config) {
    //   if (config.mandate   !== undefined) { this.mandate(config.mandate); }
    //   if (config.lock      !== undefined) { this.lock(config.lock); }
    //   if (config.display   !== undefined) { this.display(config.display); }
    //   if (config.maxlength !== undefined) { this.maxlength(config.maxlength); }
    //   if (config.criteria  !== undefined) { this.criteria(config.criteria, undefined); }
    // }
    /**
     * @summary Get the list of options for picklist/multiselect picklist fields
     * @function
     * @memberof Field
     * @example <caption>Sample</caption>
     * var field_obj = wdk.components.record_form.field('Lead_Status').getPicklistOptions();
     * @example <caption>Output</caption>
     * [
     *  { 'display_value': "-None-", 'actual_value': "-None-" },
     *  { 'id': "111111000000014736", 'filtered': false, 'display_value': "Attempted to Contact", 'actual_value': "Attempted to Contact" },
     *  { 'id': "111111000000014730", 'filtered': false, 'display_value': "Contact in Future", 'actual_value': "Contact in Future" }
     *  { 'id': "111111000000014732", 'filtered': false, 'display_value': "Contacted", 'actual_value': "Contacted" }
     * ]
     */
    getPicklistOptions() { return this.#resolver({ action: 'field_get_options',    ...this.#sel() }); }
    setSuggestions(suggestions) { return this.#resolver({ action: 'field_set_suggestions', ...this.#sel(), suggestions }); }
    getSuggestions()     { return this.#resolver({ action: 'field_get_suggestions', ...this.#sel() }); }
    patchValue(value)    { return this.#resolver({ action: 'field_patch',           ...this.#sel(), value }); }
    getValueIterator(opts) { opts = opts || {}; return new Iterator(this.getApiName(), opts.filter, opts.limit, opts.offset); }
    getConfigurator()    { return new IFieldConfigurator(this.getApiName()); }
  }

  class Subform {
    static className = 'Subform';
    #apiName; #selector; #resolver;
    constructor(api_name, selector, resolver) {
      this.#apiName = api_name; this.#selector = selector; this.#resolver = resolver || ZDKResolver;
    }
    /**
     * @summary Get the API name of subform
     * @function
     * @memberof Subform
     * @returns {Promise} api_name
     * @example
     * wdk.components.record_form.subform('CFSubform').getApiName();
     * @example <caption>Output</caption>
     * CFSubform
     */
    getApiName() { return this.#apiName; }
    #s(extra) { return { ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Get the Subform Field by api name
     * @function
     * @memberof Subform
     * @param {String} api_name - API name of the subform field
     * @returns {SubformField} Subform values
     * @example
     * wdk.components.record_form.subform('CFSubform').field('Account');
     */
    field(api_name) {
      return new SubformField(api_name, this.getApiName(), this.#selector, this.#resolver);
    }
    /**
     * @summary Set the Subform values in the subform
     * @function
     * @memberof Subform
     * @example
     * wdk.components.record_form.subform('CFSubform').setValues([{'Name': 'Zylker', 'Age': '20', ...}, {...}, ...]);
     */
    setValues(values) {
      var obj = {}; obj[this.getApiName()] = values;
      return this.#resolver({ action: 'subform_write', req_data: obj, subform_api_name: this.getApiName(), ...this.#s() });
    }
    /**
     * @summary Get the Subform values
     * @function
     * @memberof Subform
     * @returns {Array} Subform values
     * @example
     * wdk.components.record_form.subform('CFSubform').getValues();
     * @example <caption>Output</caption>
     * [{'Name': 'Zylker', 'Age': '20', ...}, {...}, ...]
     */
    getValues() { return this.#resolver({ action: 'subform_read', api_name: this.getApiName(), ...this.#s() }); }
    /**
     * @summary Get the single row of subform as Object
     * @function
     * @memberof Subform
     * @returns {Object} Subform value
     * @example
     * wdk.components.record_form.subform('CFSubform').row(0);
     * @example <caption>Output</caption>
     * {'Name': 'Zylker', 'Age': '20', ...}
     */
    row(index) {
      if (index !== 0 && !index) { throw new Error('Index is a mandatory param'); }
      if (typeof index !== 'number') { throw new TypeError('Index must be a number, not a ' + typeof index); }
      if (index < 0) { return null; }
      return new SubformRow(index, this.getApiName(), this.#selector, this.#resolver);
    }
    /**
     * @summary Inserts the input subform rows from the specified index
     * @function
     * @memberof Subform
     * @param {Array} values - Set of row values as Array
     * @param {Number} index - Starting Index of the row to be inserted
     * @example <caption>Insert at specified index</caption>
     * wdk.components.record_form.subform('CFSubform').insertRows([{'Name': 'Zylker', 'Age': '20', ...}, {...}, ...], index);
     * @example <caption>Append</caption>
     * wdk.components.record_form.subform('CFSubform').insertRows([{'Name': 'Ibro', 'Age': '21', ...}, {...}, ...]);
     */
    insertRows(values, index) {
      if (index && typeof index !== 'number') { throw new TypeError('Index must be a number, not a ' + typeof index); }
      return this.#resolver({ action: 'subform_add_row', subform_api_name: this.getApiName(), index: index !== undefined ? index : undefined, values, ...this.#s() });
    }
    /**
     * @summary Deletes the specified index row of subform
     * @function
     * @memberof Subform
     * @param {number} index - Index of the row to be deleted
     * @example
     * wdk.components.record_form.subform('CFSubform').deleteRow(index);
     */
    deleteRow(index) {
      if (index !== 0 && !index) { throw new Error('Index is a mandatory param'); }
      if (typeof index !== 'number') { throw new TypeError('Index must be a number, not a ' + typeof index); }
      if (index < 0) { throw new Error('Index value cannot be lesser than 0'); }
      return this.#resolver({ action: 'subform_delete_row', subform_api_name: this.getApiName(), index, ...this.#s() });
    }
    /**
     * @summary Clears the subform data
     * @function
     * @memberof Subform
     * @example
     * wdk.components.record_form.subform('CFSubform').clear()
     */
    clear() {
      var obj = {}; obj[this.getApiName()] = [];
      return this.#resolver({ action: 'subform_write', req_data: obj, validate: false, ...this.#s() });
    }
    /**
     * @summary Set the Subform as mandatory
     * @function
     * @memberof Subform
     * @param {Boolean} value - mandatory property (true|false)
     * @example
     * wdk.components.record_form.subform('CFSubform').mandate(true)
     */
    mandate(value) { return this.#resolver({ action: 'set_subform_mandatory', field_name: this.getApiName(), value, ...this.#s() }); }
    /**
     * @summary Set the info icon for Subform.
     * @function
     * @memberof Subform
     * @param {String} message - message/info to be added
     * @example
     * wdk.components.record_form.subform('CFSubform').info('Show tooltip');
     */
    info(message) {
      validator(message, 'message', { min_length: 1, max_length: 255, required: true, allow_null: true });
      return this.#resolver({ action: 'set_subform_info', field_name: this.getApiName(), message, ...this.#s() });
    }
    // config(config) {
    //   if (config.mandate !== undefined) { this.mandate(config.mandate); }
    //   if (config.info    !== undefined) { this.info(config.info); }
    // }
  }

  class SubformRow {
    static className = 'SubformRow';
    #index; #parent; #selector; #resolver;
    constructor(index, parent, selector, resolver) {
      this.#index = index; this.#parent = parent; this.#selector = selector; this.#resolver = resolver || ZDKResolver;
    }
    getIndex()  { return this.#index; }
    getParent() { return this.#parent; }
    #s(extra) { return { ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Get values from a specific subform row.
     * @function
     * @memberof SubformRow
     * @returns {Object} Subform values
     * @example
     * wdk.components.record_form.subform('CFSubform').row(1).getValues();
     * @example <caption>Output</caption>
     * {'Name': 'Zylker', 'Age': '20', ...}
     */
    getValues() {
      var row = this.#resolver({ action: 'subform_read_row', api_name: this.getParent(), index: this.getIndex(), ...this.#s() });
      return row || null;
    }
    /**
     * @summary Set(update) the single row of subform
     * @function
     * @memberof SubformRow
     * @param {Object} values - An object corresponding to a row in subform, where it contains the field_api_name and its value as key-value pairs
     * @example
     * wdk.components.record_form.subform('CFSubform').row(0).setValues({'Name': 'Zylker', 'Age': '20', ...});
     */
    setValues(values) { return this.#resolver({ action: 'subform_write_row', api_name: this.getParent(), index: this.getIndex(), values, ...this.#s() }); }
    /**
     * @summary Get a single cell of a Subform row
     * @function
     * @memberof SubformRow
     * @param {Object} value - Field value
     * @returns {SubformCell} {@link SubformCell}
     * @example
     * wdk.components.record_form.subform('CFSubform').row(1).cell('Name').getValue();
     * @example <caption>Output</caption>
     * Zylker
     */
    cell(api_name) {
      return new SubformCell(this.getParent(), this.getIndex(), api_name, this.#selector, this.#resolver);
    }
    /**
     * @summary Lock/Unlock the subform row (prevents user edits)
     * @function
     * @memberof SubformRow
     * @param {Boolean} value - lock for the subform Row (true|false)
     * @example
     * wdk.components.record_form.subform('CFSubform').row(0).lock(true);
     */
    lock(value) { return this.#resolver({ action: 'set_row_readonly', subform_api_name: this.getParent(), index: this.getIndex(), value, ...this.#s() }); }
  }

  class SubformCell {
    static className = 'SubformCell';
    #parent; #index; #apiName; #selector; #resolver;
    constructor(parent, index, api_name, selector, resolver) {
      this.#parent = parent; this.#index = index; this.#apiName = api_name;
      this.#selector = selector; this.#resolver = resolver || ZDKResolver;
    }
    getParent()  { return this.#parent; }
    getIndex()   { return this.#index; }
    /**
     * @summary Get the cell field API name
     * @function
     * @returns {String} Cell field API name
     * @example <caption>Sample</caption>
     * var apiName = wdk.components.record_form.subform('Line_Items').row(0).cell('Product_Name').getApiName();
     */
    getApiName() { return this.#apiName; }
    #s(extra) { return { ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Get the value of cell in a SubformRow
     * @function
     * @memberof SubformCell
     * @returns {String|Object} Cell value
     * @example
     * wdk.components.record_form.subform('CFSubform').row(1).cell('Name').getValue();
     * @example <caption>Output</caption>
     * Zylker
     */
    getValue() { return this.#resolver({ action: 'subform_read_cell', parent: this.getParent(), index: this.getIndex(), api_name: this.getApiName(), ...this.#s() }); }
    /**
     * @summary Set the value of cell in a SubformRow
     * @function
     * @memberof SubformCell
     * @param {String|Number|Boolean|Object} value - Value for the field
     * @example
     * wdk.components.record_form.subform('CFSubform').row(1).cell('Name').setValue('Zylker');
     * @example <caption>Output</caption>
     * Zylker
     */
    setValue(value) { return this.#resolver({ action: 'subform_write_cell', parent: this.getParent(), index: this.getIndex(), api_name: this.getApiName(), value, ...this.#s() }); }
    /**
     * @summary Lock/Unlock a subform cell (prevents user edits)
     * @function
     * @memberof SubformCell
     * @param {Boolean} value - lock property (true|false)
     * @example
     * wdk.components.record_form.subform('CFSubform').row(1).cell('Name').lock(true)
     */
    lock(value) { return this.#resolver({ action: 'cell_set_readonly', api_name: this.getParent(), field_name: this.getApiName(), index: this.getIndex(), value, ...this.#s() }); }
    /**
     * @summary Show inline error message for a Subform Cell
     * @function
     * @memberof SubformCell
     * @param {String} message - Text to be displayed
     * @example
     * wdk.components.record_form.subform('Quoted_Items').row(0).cell('List_Price').error('List Price cannot be zero');
     */
    error(message) {
      if (typeof message === 'string' || message instanceof String || message === null) {
        return this.#resolver({ action: 'cell_set_error', api_name: this.getParent(), field_name: this.getApiName(), index: this.getIndex(), value: message, ...this.#s() });
      }
      throw new TypeError('First argument must be a String');
    }
    // config(config) {
    //   if (config.error !== undefined) { this.error(config.error); }
    //   if (config.lock  !== undefined) { this.lock(config.lock); }
    // }
  }

  class SubformField {
    static className = 'SubformField';
    #parent; #apiName; #selector; #resolver;
    constructor(api_name, parent, selector, resolver) {
      this.#apiName = api_name; this.#parent = parent;
      this.#selector = selector; this.#resolver = resolver || ZDKResolver;
    }
    /**
     * @summary Get the API name of subform field
     * @function
     * @memberof SubformField
     * @returns {String} Subform Field
     * @example
     * wdk.components.record_form.subform('CFSubform').field('Custom_Lookup1').getApiName();
     * @example <caption>Output</caption>
     * Custom_Lookup1
     */
    getApiName() { return this.#apiName; }
    #s(extra) { return { parent: this.#parent, ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Note: Detail/Canvas detail page supports only lookup fields.
     * @description Set the criteria for lookup/picklist fields.
     * @function
     * @memberof SubformField
     * @param {String} criteria - criteria for filtering lookup records
     * @param {Object} [config] - config for lookup field criteria
     * @example <caption>Lookup supports a maximum of five criteria, each using the starts_with and equals operators. The 'id' field supports the in operator.</caption>
     * wdk.components.record_form.subform('CFSubform').field('Custom_Lookup1').criteria('((Last_Name:equals:Burns)and(First_Name:starts_with:M))', {filterOnSearch: true});
     * @example <caption>Picklist supports a maximum of five criteria, each using the starts_with, equals, ends_with, contains, not_equals and in operators.</caption>
     * wdk.components.record_form.subform('CFSubform').field('CFPicklist').criteria('((id:in:12111113441,12111113443))');
     * @example <caption>Picklist sample with value</caption>
     * wdk.components.record_form.subform('CFSubform').field('CFPicklist').criteria('((id:in:12111113441,12111113443))');
     * @example <caption>Date field range supports only one criterion with between operator.</caption>
     * wdk.components.record_form.subform('CFSubform').field('Date_1').criteria('(value:between:2023-04-18,2023-04-25)');
     * @example <caption>Dynamic Criteria</caption>
     * wdk.components.record_form.subform('CFSubform').field('Custom_Lookup1').criteria('((Last_Name:equals:{{CFSubform.Single_Line_1}}))', {filterOnSearch: true});
     */
    criteria(criteria, config) { return ZDKResolver({ action: 'subform_set_criteria', field_name: this.getApiName(), criteria, config, ...this.#s() }); }
    /**
     * @summary Locks or unlocks a subform column to prevent user edits.
     * @function
     * @memberof SubformField
     * @param {Boolean} value - lock property (true|false)
     * @example
     * wdk.components.record_form.subform('CFSubform').field('Custom_Lookup1').lock(true)
     */
    lock(value)    { return this.#resolver({ action: 'subform_set_column_readonly',  value, field_name: this.getApiName(), ...this.#s() }); }
    /**
     * @summary Set the mandatory attribute of subform field
     * @function
     * @memberof SubformField
     * @param {Boolean} value - mandatory property (true|false)
     * @example
     * wdk.components.record_form.subform('CFSubform').field('Custom_Lookup1').mandate(true)
     */
    mandate(value) { return this.#resolver({ action: 'subform_set_column_mandatory', value, field_name: this.getApiName(), ...this.#s() }); }
    /**
     * @summary Set the info icon to a subform field
     * @function
     * @memberof SubformField
     * @param {String} message - message/info to be added
     * @example
     * wdk.components.record_form.subform('CFSubform').field('Custom_Lookup1').info('This lookup is filtered by Name')
     */
    info(message) {
      validator(message, 'message', { min_length: 1, max_length: 255, required: true, allow_null: true });
      return this.#resolver({ action: 'subform_set_column_info', field_name: this.getApiName(), message, ...this.#s() });
    }
    /**
     * @summary Shows or hides a subform field.
     * @function
     * @memberof SubformField
     * @param {Boolean} value - visibility property for the subform field (true|false)
     * @example
     * wdk.components.record_form.subform('CFSubform').field('Custom_Lookup1').display(false)
     */
    display(value) { return this.#resolver({ action: 'subform_set_column_visibility', value, field_name: this.getApiName(), ...this.#s() }); }
    // config(config) {
    //   if (config.mandate !== undefined) { this.mandate(config.mandate); }
    //   if (config.display !== undefined) { this.display(config.display); }
    //   if (config.info    !== undefined) { this.info(config.info); }
    //   if (config.lock    !== undefined) { this.lock(config.lock); }
    // }
  }

  /**
   * Class representing a Blueprint Transition.
   * @category Objects
   */
  class BlueprintTransition {
    static className = 'BlueprintTransition';
    #id; #name; #selector; #resolver;
    constructor(id, name, selector, resolver) {
      this.#id = id; this.#name = name; this.#selector = selector; this.#resolver = resolver || ZDKResolver;
    }
    /**
     * @summary Get the name of the blueprint transition.
     * @function
     * @memberof BlueprintTransition
     * @returns {String} id
     * @example
     * var transObj = await wdk.components.record_detail.blueprintTransitions();
     * transObj[0].getName();
     * @example <caption>Output</caption>
     * "Convert_Lead"
     */
    getName()  { return this.#name; }
    /**
     * @summary Get the internal ID of the blueprint transition.
     * @function
     * @memberof BlueprintTransition
     * @returns {String} id
     * @example
     * var transObj = await wdk.components.record_detail.blueprintTransitions();
     * transObj[0].getId();
     * @example <caption>Output</caption>
     * "527627200000012345"
     */
    getId()    { return this.#id; }
    /**
     * @summary Initiate the transition.
     * @function
     * @memberof BlueprintTransition
     * @example
     * var transObj = await wdk.components.record_detail.blueprintTransitions();
     * transObj[0].initiate();
     */
    initiate() { return this.#resolver({ action: 'initiate_blueprint_action', id: this.#id, ...(this.#selector ? { selector: this.#selector } : {}) }); }
  }

  /**
   * Class representing a Button in a page.
   * @category Objects
   */
  class Button {
    static className = 'Button';
    #apiName; #id; #name; #type; #selector; #resolver;
    constructor(apiname, id, name, type, selector, resolver) {
      this.#apiName = apiname; this.#id = id; this.#name = name; this.#type = type;
      this.#selector = selector; this.#resolver = resolver || ZDKResolver;
    }
    #s(extra) { return { id: this.#id, api_name: this.getApiName(), ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Get the type of button
     * @function
     * @memberof Button
     * @returns {String} id
     * @example
     * var buttonObj = await wdk.components.record_form.buttons();
     * buttonObj[0].getType();
     * @example <caption>Output</caption>
     * "system" | "custom"
     */
    getType()    { return this.#type; }
    /**
     * @summary Get the API name of the button.
     * @function
     * @memberof Button
     * @returns {String} api_name
     * @example
     * var save_btn = await wdk.components.record_form.button('record_save');
     * save_btn.getApiName();
     * @example <caption>Output</caption>
     * "record_save"
     */
    getApiName() { return this.#apiName; }
    /**
     * @summary Get the internal ID of the button.
     * @function
     * @memberof Button
     * @example
     * var save_btn = await wdk.components.record_form.button('record_save');
     * save_btn.getId();
     */
    getId()      { return this.#id; }
    /**
     * @summary Get the display label of the button.
     * @function
     * @memberof Button
     * @returns {String} name
     * @example
     * var buttonObj = await wdk.components.record_form.buttons();
     * buttonObj[0].getLabel();
     * @example <caption>Output</caption>
     * "Save"
     */
    getLabel() {
      if (this.#name) { return this.#name; }
      return this.#resolver({ action: 'button_get_value', ...this.#s() });
    }
    /**
     * @summary Initiate button click event
     * @function
     * @memberof Button
     * @example
     * var save_btn = await wdk.components.record_form.button('record_save');
     * save_btn.click();
     */
    click()      { return this.#resolver({ action: 'button_click',   ...this.#s() }); }
    /**
     * @summary Disable the button (prevents user clicks).
     * @function
     * @memberof Button
     * @example
     * var save_btn = await wdk.components.record_form.button('record_save');
     * save_btn.disable();
     */
    disable()    { return this.#resolver({ action: 'button_disable', ...this.#s() }); }
    /**
     * @summary Enable the button.
     * @function
     * @memberof Button
     * @example
     * var save_btn = await wdk.components.record_form.button('record_save');
     * save_btn.enable();
     */
    enable()     { return this.#resolver({ action: 'button_enable',  ...this.#s() }); }
    /**
     * @summary Hide the button
     * @function
     * @returns {Promise} Result of hiding the button
     * @example <caption>Sample</caption>
     * wdk.components.record_form.button('record_save').hide();
     */
    hide()       { return this.#resolver({ action: 'button_hide',    ...this.#s() }); }
    /**
     * @summary Show the button
     * @function
     * @returns {Promise} Result of showing the button
     * @example <caption>Sample</caption>
     * wdk.components.record_form.button('record_save').show();
     */
    show()       { return this.#resolver({ action: 'button_show',    ...this.#s() }); }
    /**
     * @summary Set label for the button
     * @function
     * @memberof Button
     * @param {String} label - Button label
     * @example
     * var save_btn = await wdk.components.record_form.button('record_save');
     * save_btn.label('Approve & Save');
     */
    label(value) {
      if (typeof value === 'string' || value instanceof String) {
        if (value.length > 30) { throw new Error('First argument must be atmost 30 characters'); }
        if (!value.trim())     { throw new Error('First argument cannot be blank'); }
        return this.#resolver({ action: 'button_set_value', value, ...this.#s() });
      }
      throw new TypeError('First argument must be a String');
    }
  }

  /**
   * Class representing a Link in a page.
   * @category Objects
   */
  class Link {
    static className = 'Link';
    #id; #name; #selector; #resolver;
    constructor(id, name, selector, resolver) {
      this.#id = id; this.#name = name; this.#selector = selector; this.#resolver = resolver || ZDKResolver;
    }
    /**
     * @summary Get the name of the link.
     * @function
     * @memberof Link
     * @returns {String} name
     * @example
     * var linkObj = await wdk.components.record_detail.links();
     * linkObj[0].getName();
     * @example <caption>Output</caption>
     * "my_link"
     */
    getName() { return this.#name; }
    /**
     * @summary Get the internal ID of the link.
     * @function
     * @memberof Link
     * @returns {String} id
     * @example
     * var linkObj = await wdk.components.record_detail.links();
     * linkObj[0].getId();
     */
    getId()   { return this.#id; }
    #s(extra) { return { name: this.getName(), id: this.#id, ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Initiate link click event
     * @function
     * @memberof Link
     * @example
     * var linkObj = await wdk.components.record_detail.links();
     * linkObj[0].click();
     */
    click()   { return this.#resolver({ action: 'link_click',   ...this.#s() }); }
    /**
     * @summary Disable the link.
     * @function
     * @memberof Link
     * @example
     * var linkObj = await wdk.components.record_detail.links();
     * linkObj[0].disable();
     */
    disable() { return this.#resolver({ action: 'link_disable', ...this.#s() }); }
    /**
     * @summary Enable the link.
     * @function
     * @memberof Link
     * @example
     * var linkObj = await wdk.components.record_detail.links();
     * linkObj[0].enable();
     */
    enable()  { return this.#resolver({ action: 'link_enable',  ...this.#s() }); }
  }

  /**
   * Class representing the Page Selection component (canvas/wizard page tabs).
   * @category Objects
   */
  class PageSelection {
    static className = 'PageSelection';
    #selector; #resolver;
    constructor(selector, resolver) { this.#selector = selector; this.#resolver = resolver || ZDKResolver; }
    #s(extra) { return { name: 'page-selection', ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Get the current active page/tab value
     * @function
     * @returns {*} Current page value (page API name)
     * @example <caption>Sample</caption>
     * var currentPage = zdk.components.record_form.page_selection.getValue();
     * @example <caption>Output</caption>
     * 'canvas_view_1'
     */
    getValue()      { return this.#resolver({ action: 'component_get_value', ...this.#s() }); }
    /**
     * @summary Navigate to a specific page/canvas view
     * @function
     * @param {String} value - API name of the page to navigate to
     * @returns {Promise} Result of navigation
     * @example <caption>Sample</caption>
     * zdk.components.record_form.page_selection.setValue('canvas_view_api_name');
     */
    setValue(value) { return this.#resolver({ action: 'component_set_value', value, ...this.#s() }); }
    /**
     * @summary Show or hide the page selector
     * @function
     * @param {Boolean} flag - true to show, false to hide
     * @returns {Promise} Result of display operation
     * @example <caption>Sample</caption>
     * zdk.components.record_form.page_selection.display(true);
     */
    display(flag)   { return this.#resolver({ action: flag ? 'component_show' : 'component_hide', ...this.#s() }); }
  }

  /**
   * Class representing the Layout Selection component in a record form page.
   * @category Objects
   */
  class LayoutSelection {
    static className = 'LayoutSelection';
    #selector; #resolver;
    constructor(selector, resolver) { this.#selector = selector; this.#resolver = resolver || ZDKResolver; }
    #s(extra) { return { name: 'layout-selection', ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Get the currently active layout value
     * @function
     * @returns {*} Current layout ID
     * @example <caption>Sample</caption>
     * var layoutId = zdk.components.record_form.layout_selection.getValue();
     * @example <caption>Output</caption>
     * '43125880000000XXXX'
     */
    getValue()      { return this.#resolver({ action: 'component_get_value',   ...this.#s() }); }
    /**
     * @summary Set the active layout
     * @function
     * @param {String} value - Layout ID to activate
     * @returns {Promise} Result of layout change
     * @example <caption>Sample</caption>
     * zdk.components.record_form.layout_selection.setValue('43125880000000XXXX');
     */
    setValue(value) { return this.#resolver({ action: 'component_set_value',   value, ...this.#s() }); }
    /**
     * @summary Show or hide the layout selector
     * @function
     * @param {Boolean} flag - true to show, false to hide
     * @returns {Promise} Result of display operation
     * @example <caption>Sample</caption>
     * zdk.components.record_form.layout_selection.display(false);
     */
    display(flag)   { return this.#resolver({ action: flag ? 'component_show' : 'component_hide', ...this.#s() }); }
    /**
     * @summary Get available layout options
     * @function
     * @returns {Array} Array of layout option objects
     * @example <caption>Sample</caption>
     * var layouts = zdk.components.record_form.layout_selection.getOptions();
     */
    getOptions()    { return this.#resolver({ action: 'component_get_options', ...this.#s() }); }
  }

  /**
   * Class representing the Custom View Selection dropdown in a list page.
   * @category Objects
   */
  class CustomViewSelection {
    static className = 'CustomViewSelection';
    #selector; #resolver;
    constructor(selector, resolver) { this.#selector = selector; this.#resolver = resolver || ZDKResolver; }
    #s(extra) { return { name: 'list-custom-view', ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Get the currently active custom view value
     * @function
     * @returns {*} Current custom view ID
     * @example <caption>Sample</caption>
     * var viewId = zdk.components.record_list.custom_view_selection.getValue();
     * @example <caption>Output</caption>
     * '43125880000000XXXX'
     */
    getValue()          { return this.#resolver({ action: 'component_get_value',   ...this.#s() }); }
    /**
     * @summary Set the active custom view
     * @function
     * @param {String} value - Custom view ID to activate
     * @returns {Promise} Result of custom view change
     * @example <caption>Sample</caption>
     * zdk.components.record_list.custom_view_selection.setValue('43125880000000XXXX');
     */
    setValue(value)     { return this.#resolver({ action: 'component_set_value',   value, ...this.#s() }); }
    /**
     * @summary Show or hide the custom view selector
     * @function
     * @param {Boolean} flag - true to show, false to hide
     * @returns {Promise} Result of display operation
     * @example <caption>Sample</caption>
     * zdk.components.record_list.custom_view_selection.display(false);
     */
    display(flag)       { return this.#resolver({ action: flag ? 'component_show' : 'component_hide', ...this.#s() }); }
    /**
     * @summary Get available custom view options
     * @function
     * @returns {Array} Array of custom view option objects
     * @example <caption>Sample</caption>
     * var views = zdk.components.record_list.custom_view_selection.getOptions();
     */
    getOptions()        { return this.#resolver({ action: 'component_get_options', ...this.#s() }); }
    /**
     * @summary Set available custom view options
     * @function
     * @param {Array} options - Array of option objects with id property
     * @returns {Promise} Result of options update
     * @example <caption>Sample</caption>
     * zdk.components.record_list.custom_view_selection.setOptions([{ id: '43125880000000XXXX' }, { id: '43125880000000YYYY' }]);
     */
    setOptions(options) { return this.#resolver({ action: 'component_set_options', options, ...this.#s() }); }
  }

  /**
   * Class representing the View Type Selection dropdown in a list page (list/kanban/canvas etc.).
   * @category Objects
   */
  class ViewTypeSelection {
    static className = 'ViewTypeSelection';
    #selector; #resolver;
    constructor(selector, resolver) { this.#selector = selector; this.#resolver = resolver || ZDKResolver; }
    #s(extra) { return { name: 'list-view-type', ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Get the current view type value
     * @function
     * @returns {*} Current view type (list, kanban, canvas, etc.)
     * @example <caption>Sample</caption>
     * var viewType = zdk.components.record_list.view_type_selection.getValue();
     * @example <caption>Output</caption>
     * 'kanban'
     */
    getValue()      { return this.#resolver({ action: 'component_get_value', ...this.#s() }); }
    /**
     * @summary Set the active view type
     * @function
     * @param {String} value - View type to set (list, kanban, canvas, etc.)
     * @returns {Promise} Result of view type change
     * @example <caption>Sample</caption>
     * zdk.components.record_list.view_type_selection.setValue('kanban');
     */
    setValue(value) { return this.#resolver({ action: 'component_set_value', value, ...this.#s() }); }
    /**
     * @summary Show or hide the view type selector
     * @function
     * @param {Boolean} flag - true to show, false to hide
     * @returns {Promise} Result of display operation
     * @example <caption>Sample</caption>
     * zdk.components.record_list.view_type_selection.display(false);
     */
    display(flag)   { return this.#resolver({ action: flag ? 'component_show' : 'component_hide', ...this.#s() }); }
  }

  /**
   * Class representing the Notes Editor component embedded in a page.
   * @category Objects
   */
  class NotesEditor {
    static className = 'NotesEditor';
    #selector; #resolver;
    constructor(selector, resolver) { this.#selector = selector; this.#resolver = resolver || ZDKResolver; }
    #s(extra) { return { name: 'notes-editor', ...(this.#selector ? { selector: this.#selector } : {}), ...(extra || {}) }; }
    /**
     * @summary Get the current notes editor value/content
     * @function
     * @returns {*} Current notes content
     * @example <caption>Sample</caption>
     * var notes = zdk.components.record_detail.notes_editor.getValue();
     * @example <caption>Output</caption>
     * 'Customer meeting scheduled for Monday'
     */
    getValue()      { return this.#resolver({ action: 'component_get_value', ...this.#s() }); }
    /**
     * @summary Set the notes editor value/content
     * @function
     * @param {*} value - Notes content to set
     * @returns {Promise} Result of notes update
     * @example <caption>Sample</caption>
     * zdk.components.record_detail.notes_editor.setValue('Updated note content');
     */
    setValue(value) { return this.#resolver({ action: 'component_set_value', value, ...this.#s() }); }
    /**
     * @summary Show or hide the notes editor
     * @function
     * @param {Boolean} flag - true to show, false to hide
     * @returns {Promise} Result of display operation
     * @example <caption>Sample</caption>
     * zdk.components.record_detail.notes_editor.display(true);
     */
    display(flag)   { return this.#resolver({ action: flag ? 'component_show' : 'component_hide', ...this.#s() }); }
  }

  /**
   * Class representing a UI element on a Canvas or Wizard page.
   * @category Objects
   */
  class UIElement {
    #id;
    constructor(id) { this.#id = id; }
    /**
     * @summary Get element ID
     * @function
     * @returns {String} Element ID
     * @example <caption>Sample</caption>
     * var elemId = elem.getId();
     */
    getId()   { return this.#id; }
    /**
     * @summary Display the heading UI element.
     * @function
     * @memberof UIElement
     * @example
     * var headingObj = await wdk.components.record_detail.ui_element('heading_id');
     * headingObj.display();
     */
    display(flag)       { return ZDKResolver({ action: flag ? 'canvas_show' : 'canvas_hide',      id: this.#id }); }
    /**
     * @summary Add a tooltip to the heading UI element.
     * @function
     * @memberof UIElement
     * @example
     * var headingObj = await wdk.components.record_detail.ui_element('heading_id');
     * headingObj.tooltip();
     */
    tooltip(config)     { return ZDKResolver({ action: 'canvas_tooltip_add',                      id: this.#id, config }); }
    /**
     * @summary Remove the tooltip from the heading UI element.
     * @function
     * @memberof UIElement
     * @example
     * var headingObj = await wdk.components.record_detail.ui_element('heading_id');
     * headingObj.removeToolTip();
     */
    removeToolTip()     { return ZDKResolver({ action: 'canvas_toooltip_remove',                  id: this.#id }); }
    /**
     * @summary Apply custom styles to the heading UI element.
     * @function
     * @memberof UIElement
     * @example
     * var headingObj = await wdk.components.record_detail.ui_element('heading_id');
     * headingObj.style();
     */
    style(config)       { return ZDKResolver({ action: 'canvas_set_style',                        id: this.#id, config }); }
    /**
     * @summary Freeze the heading UI element.
     * @function
     * @memberof UIElement
     * @example
     * var headingObj = await wdk.components.record_detail.ui_element('heading_id');
     * headingObj.freeze();
     */
    freeze(value)       { return ZDKResolver({ action: 'canvas_freeze',                           id: this.#id, value }); }
    /**
     * @summary Lock the heading UI element.
     * @function
     * @memberof UIElement
     * @example
     * var headingObj = await wdk.components.record_detail.ui_element('heading_id');
     * headingObj.lock();
     */
    lock(value)         { return ZDKResolver({ action: 'set_related_list_readonly',               id: this.#id, value }); }
    /**
     * @summary Set the text content of the heading UI element.
     * @function
     * @memberof UIElement
     * @param {String} content - heading text to be displayed
     * @example
     * var headingObj = await wdk.components.record_detail.ui_element('heading_id');
     * headingObj.setContent('Customer Details');
     */
    setContent(value)   { return ZDKResolver({ action: 'canvas_set_content',                      id: this.#id, value }); }
    /**
     * @summary Set an image for the UI element.
     * @function
     * @memberof UIElement
     * @param {Object} image - image options. Use { type: 'url', url: '' } or { type: 'userId', userId: '' }
     * @example
     * var elem = wdk.components.record_form.ui_element('img1');
     * elem.setImage({ type: 'url', url: 'https://www.example.com/image.jpeg' });
     * @example
     * var elem = wdk.components.record_form.ui_element('img1');
     * elem.setImage({ type: 'userId', userId: '111222333444555' });
     */
    setImage(value)     { return ZDKResolver({ action: 'canvas_set_image',                        id: this.#id, value }); }
    /**
     * @summary Set the UI element as active.
     * @function
     * @memberof UIElement
     * @example
     * var elem = wdk.components.record_form.ui_element('tab1');
     * elem.setActive();
     */
    setActive()         { return ZDKResolver({ action: 'canvas_tab_set_active',                   id: this.#id }); }
    /**
     * @summary Scroll page to element location
     * @function
     * @returns {Promise} Result of scroll operation
     * @example <caption>Sample</caption>
     * zdk.components.record_form.ui_element('myElem').scrollTo();
     */
    scrollTo()          { return ZDKResolver({ action: 'canvas_scrollTo',                         id: this.#id }); }
    /**
     * @summary Highlight element
     * @function
     * @param {Object} config - Highlight configuration
     * @param {Number} [config.time] - Duration to highlight in milliseconds
     * @returns {Promise} Result of highlight operation
     * @example <caption>Sample</caption>
     * zdk.components.record_form.ui_element('myElem').highlight({time: 1000});
     */
    highlight(config)   { return ZDKResolver({ action: 'canvas_blink',                            id: this.#id, config }); }
  }

  // ── Abstract base page classes ───────────────────────────────────────────────

  // Needed by class methods below: if ZDKResolver returned a Promise (iframe context),
  // chains mapFn via .then(); otherwise calls mapFn directly (CScript sync context).
  // Declared here as a function declaration so it is hoisted to the IIFE scope and
  // available both above and below this point in the source.
  function _resolveAndMap(p, mapFn) {
    if (p && typeof p.then === 'function') { return p.then(mapFn); }
    return mapFn(p);
  }

  class RecordPageBase {
    #module;
    constructor(module) { this.#module = module; }
    /**
     * @summary Get page context information
     * @memberof RecordPageBase
     * @function
     * @returns {Object|Promise} Page info object (module, layout_id, component, record_id, etc.)
     * @example <caption>Sample</caption>
     * zdk.components.record_form.getInfo();
     * @example <caption>Output</caption>
     * { module: 'Leads', layout_id: '527627200000009XXXX', component: 'record_form' }
     */
    getInfo() {
      var self_module = this.#module;
      var className = this.constructor.className;
      return _resolveAndMap(
        ZDKResolver({ action: 'page_info', config: { include_module_apiname: true } }),
        function (pi) {
          return {
            module: self_module || (pi && (pi.module_apiname || pi.module)),
            layout_id: pi && pi.layout_id,
            component: className && className.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
          };
        }
      );
    }
    /**
     * @summary Get a button by API name
     * @memberof RecordPageBase
     * @function
     * @param {String} api_name - Button API name
     * @returns {Button|null} Button object or null if not found
     * @example <caption>Sample</caption>
     * var saveBtn = zdk.components.record_form.button('record_save');
     * @example <caption>Output</caption>
     * Button { #apiName: 'record_save', #name: 'Save', #type: 'system' }
     */
    button(api_name) {
      return _resolveAndMap(
        ZDKResolver({ action: 'get_button_apiname', api_name }),
        function (b) { return b ? new Button(b.api_name, null, b.name, b.type, 'root') : null; }
      );
    }
    /**
     * @summary Get all buttons in the page
     * @memberof RecordPageBase
     * @function
     * @returns {Button[]|Promise} Array of Button objects
     * @example <caption>Sample</caption>
     * var allButtons = zdk.components.record_form.buttons();
     * @example <caption>Iterate buttons</caption>
     * allButtons.forEach(btn => console.log(btn.getLabel()));
     */
    buttons() {
      return _resolveAndMap(
        ZDKResolver({ action: 'button_list' }),
        function (list) { return list.map(function (x) { return new Button(x.api_name, x.id, x.name, x.type, 'root'); }); }
      );
    }
    /**
     * @summary Get a UI element by ID for Canvas/Wizard page interactions
     * @memberof RecordPageBase
     * @function
     * @param {String} element_id - Element ID on Canvas or Wizard page
     * @returns {UIElement|null} UIElement object or null if not found
     * @example <caption>Sample</caption>
     * var elem = zdk.components.record_form.ui_element('mySection');
     * elem.display(false);
     * @example <caption>With methods</caption>
     * zdk.components.record_form.ui_element('myElem').style({'background-color': 'red'});
     */
    ui_element(element_id) {
      return _resolveAndMap(
        ZDKResolver({ action: 'get_elem', id: element_id }),
        function (a) { return a ? new UIElement(a.id) : null; }
      );
    }
  }

  class RecordFormPageBase extends RecordPageBase {
    /**
     * @summary Get a field by API name
     * @memberof RecordFormPageBase
     * @function
     * @param {String} api_name - Field API name
     * @returns {Field|null} Field object or null if not found
     * @example <caption>Sample</caption>
     * var emailField = zdk.components.record_form.field('Email');
     * emailField.setValue('test@example.com');
     * @example <caption>Chain operations</caption>
     * zdk.components.record_form.field('Last_Name').lock(true).mandate(true);
     */
    field(api_name) {
      // Construct directly — in iframe ZDKResolver returns a Promise, so using its
      // result synchronously yields undefined api_name and breaks all field method calls.
      return new Field(api_name, 'root');
    }
    /**
     * @summary Get all fields in the page
     * @memberof RecordFormPageBase
     * @function
     * @returns {Field[]|Promise} Array of Field objects
     * @example <caption>Sample</caption>
     * var allFields = zdk.components.record_form.fields();
     * @example <caption>Iterate and configure</caption>
     * allFields.forEach(fld => fld.display(true));
     */
    fields() {
      return _resolveAndMap(
        ZDKResolver({ action: 'form_read' }),
        function (fs) { return Object.keys(fs).map(function (x) { return new Field(x, 'root'); }); }
      );
    }
    /**
     * @summary Get a subform by API name
     * @memberof RecordFormPageBase
     * @function
     * @param {String} api_name - Subform API name
     * @returns {Subform|Promise} Subform object
     * @example <caption>Sample</caption>
     * var subform = zdk.components.record_form.subform('LineItems');
     * var rows = subform.getValues();
     * @example <caption>Add row</caption>
     * subform.insertRows({Name: 'Item1', Quantity: 5}, 0);
     */
    subform(api_name) {
      // Construct directly — same reason as field().
      return new Subform(api_name, 'root');
    }
    /**
     * @summary Get all form field values as a plain object
     * @memberof RecordFormPageBase
     * @function
     * @returns {Object|Promise} Field api_name → value map
     * @example <caption>Sample</caption>
     * var values = zdk.components.record_form.getValues();
     * @example <caption>Output</caption>
     * { Last_Name: 'Zylker', Email: 'zylker@example.com', Phone: '+1234567890' }
     */
    getValues() { return ZDKResolver({ action: 'form_read',   selector: 'root' }); }
    /**
     * @summary Set multiple form field values in one call
     * @memberof RecordFormPageBase
     * @function
     * @param {Object} values - Field api_name → value map
     * @returns {Promise} Result of values update
     * @example <caption>Sample</caption>
     * zdk.components.record_form.setValues({ Last_Name: 'Zylker', Email: 'zylker@example.com' });
     * @example <caption>Multiple fields</caption>
     * zdk.components.record_form.setValues({ First_Name: 'John', Last_Name: 'Doe', Phone: '555-1234' });
     */
    setValues(values) { return ZDKResolver({ action: 'form_write', req_data: values, selector: 'root' }); }
    /**
     * @summary Bulk-set field properties across multiple fields in one call
     * @memberof RecordFormPageBase
     * @function
     * @param {Object} config - Map of field api_name → property config
     * @param {Boolean} [config[field].mandate] - Set mandatory attribute
     * @param {Boolean} [config[field].lock] - Lock/Unlock field
     * @param {Boolean} [config[field].display] - Set visibility
     * @param {Number} [config[field].maxlength] - Set max length
     * @returns {Promise} Result of config operation
     * @example <caption>Sample</caption>
     * zdk.components.record_form.config({
     *   Last_Name: { mandate: true, lock: false },
     *   Email: { display: true, maxlength: 100 },
     *   Phone: { display: false }
     * });
     */
    // config(config) { return ZDKResolver({ action: 'form_config', req_data: config, selector: 'root' }); }
  }

  /**
   * Class representing a Record Create/Edit/Clone page Instance.
   * @class RecordForm
   * @category Components
   */
  class RecordForm extends RecordFormPageBase {
    static className = 'RecordForm';
    constructor(module) { super(module); }
    /**
     * @summary Get a button on the page by its API name.
     * @function
     * @memberof RecordForm
     * @param {String} api_name - API Name of the button
     * @returns {Promise} {@link Button} object
     * @example
     * wdk.components.record_form.button('record_save').then(function(data){
     *   console.log(data);
     * });
     */
    button(api_name)   { return super.button(api_name); }
    /**
     * @summary Get the list of buttons in the page as an array
     * @function
     * @memberof RecordForm
     * @returns {Promise} {@link Button} object
     * @example
     * wdk.components.record_form.buttons().then(function(data){
     *   console.log(data);
     * });
     */
    buttons()          { return super.buttons(); }
    /**
     * @summary Get the Field by api name
     * @function
     * @memberof RecordForm
     * @param {String} api_name - API Name of the field
     * @returns {Field} {@link Field} object
     * @example
     * wdk.components.record_form.field('Last_Name');
     */
    field(api_name)    { return super.field(api_name); }
    /**
     * @summary Get the list of fields in the page as an array
     * @function
     * @memberof RecordForm
     * @returns {Promise} {@link Field} object
     * @example
     * wdk.components.record_form.fields().then(function(data){
     *   console.log(data);
     * });
     */
    fields()           { return super.fields(); }
    /**
     * @summary Get the Subform by api name
     * @function
     * @memberof RecordForm
     * @param {String} api_name - API Name of the subform
     * @returns {Subform} {@link Subform} object
     * @example
     * wdk.components.record_form.subform('CFSubform');
     */
    subform(api_name)  { return super.subform(api_name); }
    /**
     * @summary Get all form field values as a plain object
     * @function
     * @memberof RecordForm
     * @returns {Promise} Field value map
     * @example
     * wdk.components.record_form.getValues().then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * { 'Last_Name' : 'Zylker Ibro',
     *  'Subform_1' : [ {
     *  'Email_1' : 'henry@zylker.com',
     *  'Website1' : 'www.henryzyker.com'
     * } ],
     *  'Email_1': 'henry@zylker.com',
     *  'Email_Opt_Out': true, ... }
     */
    getValues()        { return super.getValues(); }
    /**
     * @summary Set multiple form field values in one call
     * @function
     * @memberof RecordForm
     * @param {Object} values - Field api_name → value map
     * @example
     * wdk.components.record_form.setValues({ 'Last_Name': 'Zylker', 'Email': 'zylker@example.com' }).then(function(data){
     *   console.log(data);
     * });
     */
    setValues(values)  { return super.setValues(values); }
    /**
     * @summary Bulk-set field properties across multiple fields in one call
     * @memberof RecordForm
     * @function
     * @param {Object} config - Map of field api_name → property config
     * @returns {Promise} Result of config operation
     * @example <caption>Sample</caption>
     * zdk.components.record_form.config({ Last_Name: { mandate: true } });
     */
    // config(config)     { return super.config(config); }
    /**
     * @summary Get page context information as a plain object.
     * @function
     * @memberof RecordForm
     * @returns {Promise} Page context info
     * @example
     * wdk.components.record_form.getInfo().then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * { module: 'Leads', layout_id: '527627200000009XXXX', component: 'record_form', record_id: '5276272000000364001', record: { id: '5276272000000364001' } }
     */
    getInfo() {
      var base = super.getInfo();
      var piProm = ZDKResolver({ action: 'page_info', config: { include_module_apiname: true } });
      if (base && typeof base.then === 'function') {
        return Promise.all([base, piProm]).then(function (results) {
          var b = results[0], pi = results[1];
          var record_id = pi && pi.record_id;
          return Object.assign({}, b, { parent_record_id: pi && pi.parent_record_id, record_id: record_id, record: record_id ? { id: record_id } : undefined });
        });
      }
      var record_id = piProm && piProm.record_id;
      return Object.assign({}, base, { parent_record_id: piProm && piProm.parent_record_id, record_id: record_id, record: record_id ? { id: record_id } : undefined });
    }
    /**
     * @summary Gets a UIElement by its ID for interactions on Canvas and Wizard pages.
     * @function
     * @memberof RecordForm
     * @param {String} element_id - ID of the element on the Canvas or Wizard page
     * @returns {Promise} {@link UIElement} object
     * @example
     * wdk.components.record_form.ui_element('mySection').then(function(data){
     *   console.log(data);
     * });
     */
    ui_element(eid)        { return super.ui_element(eid); }
    /**
     * @summary Get the Page Selection component (for canvas/wizard page tabs)
     * @memberof RecordForm
     * @instance
     * @type {PageSelection}
     * @example <caption>Get current page</caption>
     * zdk.components.record_form.page_selection.getValue();
     * @example <caption>Navigate to page</caption>
     * zdk.components.record_form.page_selection.setValue('page_api_name');
     */
    get page_selection()   { return new PageSelection('root'); }
    /**
     * @summary Get the Layout Selection component
     * @memberof RecordForm
     * @instance
     * @type {LayoutSelection}
     * @example <caption>Get current layout</caption>
     * zdk.components.record_form.layout_selection.getValue();
     * @example <caption>Set layout</caption>
     * zdk.components.record_form.layout_selection.setValue('43125880000000XXXX');
     */
    get layout_selection() { return new LayoutSelection('root'); }
  }

  /**
   * Class representing a Quick Create popup page Instance.
   * @class RecordQuickCreate
   * @category Components
   */
  class RecordQuickCreate extends RecordPageBase {
    static className = 'RecordQuickCreate';
    constructor(module) { super(module); }
    /**
     * @summary Get a button on the page by its API name.
     * @function
     * @memberof RecordQuickCreate
     * @example
     * wdk.components.record_quick_create.button('api');
     * @example <caption>Output</caption>
     * // returns Promise<any>
     * const result = await wdk.components.record_quick_create.button('api');
     * console.log(result);
     */
    button(api_name) { return super.button(api_name); }
    /**
     * @summary Get the list of buttons in the page as an array
     * @function
     * @memberof RecordQuickCreate
     * @example
     * wdk.components.record_quick_create.buttons();
     * @example <caption>Output</caption>
     * // returns Promise<any>
     * const result = await wdk.components.record_quick_create.buttons();
     * console.log(result);
     */
    buttons()        { return super.buttons(); }
    /**
     * @summary Get the Field by api name
     * @function
     * @memberof RecordQuickCreate
     * @example
     * wdk.components.record_quick_create.field('Last_Name').getValue();
     * @example <caption>Output</caption>
     * // returns Promise<any>
     * const result = await wdk.components.record_quick_create.field('Last_Name').getValue();
     * console.log(result);
     */
    field(api_name) { return new Field(api_name, 'root'); }
    /**
     * @summary Get the list of fields in the page as an array
     * @function
     * @memberof RecordQuickCreate
     * @example
     * wdk.components.record_quick_create.fields();
     * @example <caption>Output</caption>
     * // returns Promise<any>
     * const result = await wdk.components.record_quick_create.fields();
     * console.log(result);
     */
    fields() {
      return _resolveAndMap(
        ZDKResolver({ action: 'form_read' }),
        function (fs) { return Object.keys(fs).map(function (x) { return new Field(x, 'root'); }); }
      );
    }
    /**
     * @summary Get page context information as a plain object.
     * @function
     * @memberof RecordQuickCreate
     * @example
     * wdk.components.record_quick_create.getInfo();
     * @example <caption>Output</caption>
     * { module: 'Leads', layout_id: '527627200000009XXXX', component: 'record_quick_create' }
     */
    getInfo()    { return super.getInfo(); }
    /**
     * @summary Method exposed by wdk.components.record_quick_create.
     * @function
     * @memberof RecordQuickCreate
     * @example
     * wdk.components.record_quick_create.getParentComponent();
     * @example <caption>Output</caption>
     * // returns Promise<any>
     * const result = await wdk.components.record_quick_create.getParentComponent();
     * console.log(result);
     */
    getParentComponent() {
      return _resolveAndMap(
        ZDKResolver({ action: 'get_parent_component' }),
        function (p) {
          var name = p && (p.name || p.component);
          if (name === 'record_form')   { return Object.assign(function (m) { return new RecordForm(m); },   new RecordForm(p && p.module)); }
          if (name === 'record_detail') { return Object.assign(function (m) { return new RecordDetail(m); }, new RecordDetail(p && p.module)); }
          return Object.assign(function (m) { return new RecordList(m); }, new RecordList(p && p.module));
        }
      );
    }
    /**
     * @summary Method exposed by wdk.components.record_quick_create.
     * @function
     * @memberof RecordQuickCreate
     * @example
     * wdk.components.record_quick_create.ui_element('elemId');
     * @example <caption>Output</caption>
     * // returns Promise<any>
     * const result = await wdk.components.record_quick_create.ui_element('elemId');
     * console.log(result);
     */
    ui_element(eid) { return super.ui_element(eid); }
    /**
     * @summary Get all form field values as a plain object
     * @function
     * @memberof RecordQuickCreate
     * @example
     * wdk.components.record_quick_create.getValues();
     * @example <caption>Output</caption>
     * // returns Promise<any>
     * const result = await wdk.components.record_quick_create.getValues();
     * console.log(result);
     */
    getValues()     { return ZDKResolver({ action: 'form_read',   selector: 'root' }); }
    /**
     * @summary Method exposed by wdk.components.record_quick_create.
     * @function
     * @memberof RecordQuickCreate
     * @example
     * wdk.components.record_quick_create.setValues({ Last_Name: 'X' });
     * @example <caption>Output</caption>
     * // returns Promise<any>
     * const result = await wdk.components.record_quick_create.setValues({ Last_Name: 'X' });
     * console.log(result);
     */
    setValues(v)    { return ZDKResolver({ action: 'form_write',  req_data: v, selector: 'root' }); }
    /**
     * @summary Bulk-set field properties across multiple fields in one call
     * @memberof RecordQuickCreate
     * @function
     * @param {Object} config - Map of field api_name → property config
     * @returns {Promise} Result of config operation
     * @example <caption>Sample</caption>
     * zdk.components.record_quick_create.config({Last_Name: {mandate: true}});
     */
    // config(c)       { return ZDKResolver({ action: 'form_config', req_data: c, selector: 'root' }); }
    /**
     * @summary Get the Layout Selection component
     * @memberof RecordQuickCreate
     * @instance
     * @type {LayoutSelection}
     * @returns {LayoutSelection} LayoutSelection component instance
     * @example <caption>Get current layout</caption>
     * var layoutId = zdk.components.record_quick_create.layout_selection.getValue();
     */
    get layout_selection() { return new LayoutSelection('root'); }
  }

  /**
   * Class representing a Record Detail page Instance.
   * @class RecordDetail
   * @category Components
   */
  class RecordDetail extends RecordFormPageBase {
    static className = 'RecordDetail';
    constructor(module) { super(module); }
    /**
     * @summary Get a button on the page by its API name.
     * @function
     * @memberof RecordDetail
     * @param {String} api_name - API Name of the button
     * @returns {Button} {@link Button} object
     * @example
     * wdk.components.record_detail.button('record_save');
     */
    button(api_name)  { return super.button(api_name); }
    /**
     * @summary Get the list of buttons in the page as an array
     * @function
     * @memberof RecordDetail
     * @returns {Array.<Button>} Array of {@link Button} objects
     * @example
     * wdk.components.record_detail.buttons();
     */
    buttons()         { return super.buttons(); }
    /**
     * @summary Get the Field by api name
     * @function
     * @memberof RecordDetail
     * @param {String} apiName - API name of the field
     * @returns {Field} {@link Field} object
     * @example
     * wdk.components.record_detail.field('Last_Name').getValue()
     */
    field(api_name)   { return super.field(api_name); }
    /**
     * @summary Get the list of fields in the page as an array
     * @function
     * @memberof RecordDetail
     * @returns {Array.<Field>} Array of {@link Field} objects
     * @example
     * wdk.components.record_detail.fields()
     */
    fields()          { return super.fields(); }
    /**
     * @summary Get the Subform by api name
     * @function
     * @memberof RecordDetail
     * @param {String} api_name - API Name of the subform
     * @returns {Subform} {@link Subform} object
     * @example
     * wdk.components.record_detail.subform('CFSubform');
     */
    subform(api_name) { return super.subform(api_name); }
    /**
     * @summary Get a button on the page by its API name.
     * @function
     * @memberof RecordDetail
     * @returns {Object} Field value map
     * @example
     * wdk.components.record_detail.getValues();
     */
    getValues()       { return super.getValues(); }
    /**
     * @summary Set multiple form field values in one call
     * @memberof RecordDetail
     * @function
     * @param {Object} values - Field api_name → value map
     * @returns {Promise} Result of values update
     * @example <caption>Sample</caption>
     * zdk.components.record_detail.setValues({Email: 'new@example.com'});
     */
    // setValues(v)      { return super.setValues(v); }
    /**
     * @summary Bulk-set field properties across multiple fields in one call
     * @memberof RecordDetail
     * @function
     * @param {Object} config - Map of field api_name → property config
     * @returns {Promise} Result of config operation
     * @example <caption>Sample</caption>
     * zdk.components.record_detail.config({Email: {display: true, mandate: true}});
     */
    // config(c)         { return super.config(c); }
    /**
     * @summary Get page context information as a plain object.
     * @function
     * @memberof RecordDetail
     * @returns {Object} Page context info
     * @example
     * wdk.components.record_detail.getInfo();
     */
    getInfo() {
      var base = super.getInfo();
      var piProm = ZDKResolver({ action: 'page_info', config: { include_module_apiname: true } });
      if (base && typeof base.then === 'function') {
        return Promise.all([base, piProm]).then(function (results) {
          var b = results[0], pi = results[1];
          var record_id = pi && pi.record_id;
          return Object.assign({}, b, { record_id: record_id, record: record_id ? { id: record_id } : undefined });
        });
      }
      var record_id = piProm && piProm.record_id;
      return Object.assign({}, base, { record_id: record_id, record: record_id ? { id: record_id } : undefined });
    }
    /**
     * @summary Get the list of links in the page as an array
     * @function
     * @memberof RecordDetail
     * @returns {Array.<Link>} Array of {@link Link} objects
     * @example
     * wdk.components.record_detail.links();
     */
    links() {
      return _resolveAndMap(
        ZDKResolver({ action: 'link_list' }),
        function (list) { return list.map(function (x) { return new Link(x.id, x.name, 'root'); }); }
      );
    }
    /**
     * @summary Get blueprint transitions in page
     * @function
     * @memberof RecordDetail
     * @returns {Array.<BlueprintTransition>} Array of {@link BlueprintTransition} objects
     * @example
     * wdk.components.record_detail.blueprintTransitions();
     */
    blueprintTransitions() {
      return _resolveAndMap(
        ZDKResolver({ action: 'get_blueprint_transitions' }),
        function (ts) { return ts ? ts.map(function (x) { return new BlueprintTransition(x.id, x.name, 'root'); }) : []; }
      );
    }
    /**
     * @summary Add tags in the page
     * @function
     * @memberof RecordDetail
     * @param {String} tag_names - Name of the tag
     * @example <caption>Add a tag</caption>
     * wdk.components.record_detail.addTag('tagname');
     * @example <caption>Add multiple tags</caption>
     * wdk.components.record_detail.addTag('tagname1', 'tagname2', 'tagname3');
     */
    addTag(...tag_names)    { return ZDKResolver({ action: 'tag_add',    tag_name: Array.from(tag_names).filter(x => typeof x === 'string') }); }
    /**
     * @summary Remove tags in the page
     * @function
     * @memberof RecordDetail
     * @param {String} tag_names - Name of the tag
     * @example <caption>Remove a tag</caption>
     * wdk.components.record_detail.removeTag('tagname');
     * @example <caption>Remove multiple tags</caption>
     * wdk.components.record_detail.removeTag('tagname1', 'tagname2', 'tagname3');
     */
    removeTag(...tag_names) { return ZDKResolver({ action: 'tag_remove', tag_name: Array.from(tag_names).filter(x => typeof x === 'string') }); }
    /**
     * @summary Get the list of tags in the page as array of objects
     * @function
     * @memberof RecordDetail
     * @returns {Array.<Object>} Array of tag objects, each containing a 'name' property
     * @example
     * wdk.components.record_detail.getTags();
     * @example <caption>Output</caption>
     * [{ name: 'tag1' }, { name : 'atom' }, { name : 'busy' }]
     */
    getTags()               { return ZDKResolver({ action: 'tag_list' }) || null; }
    /**
     * @summary Get a UIElement by id for Canvas/Detail page interactions.
     * @function
     * @memberof RecordDetail
     * @param {string} element_id - ID of the element on the Canvas page
     * @returns {ui.UIElement|null} The UI element object corresponding to the given element_id
     * @example
     * wdk.components.record_detail.ui_element('mySection').display(false);
     */
    ui_element(eid)         { return super.ui_element(eid); }
    /**
     * @summary Get the Notes Editor component
     * @memberof RecordDetail
     * @instance
     * @type {NotesEditor}
     * @returns {NotesEditor} NotesEditor component instance
     * @example <caption>Get notes</caption>
     * var notes = zdk.components.record_detail.notes_editor.getValue();
     */
    get notes_editor()      { return new NotesEditor('root'); }
    /**
     * @summary Get the Custom View Selection component
     * @memberof RecordDetail
     * @instance
     * @type {CustomViewSelection}
     * @returns {CustomViewSelection} CustomViewSelection component instance
     * @example <caption>Get current view</caption>
     * var viewId = zdk.components.record_detail.custom_view_selection.getValue();
     */
    get custom_view_selection() { return new CustomViewSelection('root'); }
    /**
     * @summary Get the Page Selection component (for canvas/wizard page tabs)
     * @memberof RecordDetail
     * @instance
     * @type {PageSelection}
     * @returns {PageSelection} PageSelection component instance
     * @example <caption>Get current page</caption>
     * var currentPage = zdk.components.record_detail.page_selection.getValue();
     */
    get page_selection()    { return new PageSelection('root'); }
  }

  /**
   * Class representing a Record List page Instance.
   * @class RecordList
   * @category Components
   */
  class RecordList extends RecordPageBase {
    static className = 'RecordList';
    constructor(module) { super(module); }
    /**
     * @summary Get page context information as a plain object.
     * @function
     * @memberof RecordList
     * @returns {Object} Page context info
     * @example
     * wdk.components.record_list.getInfo();
     * @example <caption>Output</caption>
     * { module: 'Leads', layout_id: '527627200000009XXXX', component: 'record_list' }
     */
    getInfo()  { return super.getInfo(); }
    /**
     * @summary Get a button on the page by its API name.
     * @function
     * @memberof RecordList
     * @param {String} api_name - API Name of the button
     * @returns {Button} {@link Button} object
     * @example
     * wdk.components.record_list.button('record_save');
     */
    button(api_name) { return super.button(api_name); }
    /**
     * @summary Get the list of buttons in the page as an array
     * @function
     * @memberof RecordList
     * @returns {Array.<Button>} Array of {@link Button} objects
     * @example
     * wdk.components.record_list.buttons();
     */
    buttons()        { return super.buttons(); }
    /**
     * @summary Freeze the list view and prevent users from modifying its columns.
     * @function
     * @memberof RecordList
     * @param {Boolean} option - freeze option true/false
     * @example
     * wdk.components.record_list.freezeColumns(true);
     */
    freezeColumns(option) { return ZDKResolver({ action: 'list_fields_freeze', option: !!option, selector: 'root' }); }
    /**
     * @summary Mask fields in the List View
     * @function
     * @memberof RecordList
     * @param {String} field_name - Api Name of field
     * @param {Object} config - masking configuration
     * @param {Number} config.length - length of characters to be masked
     * @param {Char} config.character - character to be used for masking
     * @param {Boolean} config.reverse - masking to be done in reverse (true/false)
     * @example
     * wdk.components.record_list.maskField('Email', {length: 8, character: '#', reverse: true});
     */
    maskField(field_name, config) {
      if (!config.length || config.length < 1) { throw new Error('invalid length - ' + config.length); }
      return ZDKResolver({ action: 'list_fields_mask', field_name, config, selector: 'root' });
    }
    /**
     * @summary Sort the list view by a field.
     * @function
     * @memberof RecordList
     * @param {String} field_name - Api Name of field
     * @param {String} option - sort option {asc | desc | unsort}
     * @example
     * wdk.components.record_list.sortByField('Email', 'asc');
     */
    sortByField(field_name, option) { return ZDKResolver({ action: 'list_fields_sort',        field_name, option, selector: 'root' }); }
    /**
     * @summary Get records in the list view, where the $selected property indicates whether a record is selected.
     * @function
     * @memberof RecordList
     * @example
     * wdk.components.record_list.getRecords();
     */
    getRecords()        { return ZDKResolver({ action: 'list_records_get',                                         selector: 'root' }); }
    /**
     * @summary Select Records in the List view by criteria
     * @function
     * @memberof RecordList
     * @param {String} criteria - criteria based on which records should be selected. Fields that are in the list are only available for criteria.
     * @example
     * wdk.components.record_list.selectRecords('((Last_Name:equals:Burns)and(First_Name:starts_with:M))');
     */
    selectRecords(c)    { return ZDKResolver({ action: 'list_records_select',        criteria: c,                  selector: 'root' }); }
    /**
     * @summary Select Records in the List view by record ID
     * @function
     * @memberof RecordList
     * @param {Array.<String>} ids - array of record ids
     * @example
     * wdk.components.record_list.selectRecordsByID(['111111000000000812', '111111000000000834', '111111000000000845']);
     */
    selectRecordsByID(ids) {
      if (!Array.isArray(ids)) { throw new TypeError('ids should be an Array'); }
      return ZDKResolver({ action: 'list_records_select_id', ids, selector: 'root' });
    }
    /**
     * @summary Clear selected Records in the List view
     * @function
     * @memberof RecordList
     * @example
     * wdk.components.record_list.clearSelection();
     */
    clearSelection()    { return ZDKResolver({ action: 'list_records_clear_selected',                              selector: 'root' }); }
    /**
     * @summary Apply Styles to Records in the List View
     * @function
     * @memberof RecordList
     * @param {Object} style_config - style_config to be added to the records
     * @param {Object} style_config.record - To add record level stylings. Supported options - backgroundColor
     * @param {Object} style_config.field - To add field level stylings. Supported options - backgroundColor, fontWeight, foregroundColor
     * @param {String} criteria - criteria based on which records should be selected
     * @example <caption>Style records on criteria</caption>
     * wdk.components.record_list.style({record: {backgroundColor: '#ff0000'},field: {Email: {foregroundColor: '#ff0000', fontWeight: 'bold'}}},'((Last_Name:equals:Burns)and(First_Name:starts_with:M))');
     * @example <caption>Remove Style on records</caption>
     * wdk.components.record_list.style({record: {}, field: {}},'((Last_Name:equals:Burns)and(First_Name:starts_with:M))');
     */
    style(style_config, criteria) { return ZDKResolver({ action: 'list_records_style', style_config, criteria,    selector: 'root' }); }
    /**
     * @summary Get a UIElement by id for Canvas/Wizard page interactions.
     * @function
     * @memberof RecordList
     * @param {String} element_id - ID of the element on the Canvas page
     * @returns {ui.UIElement | null} {@link UIElement} object
     * @example
     * wdk.components.record_list.ui_element('mySection').display(false);
     */
    ui_element(eid)     { return super.ui_element(eid); }
    /**
     * @summary Get the Custom View Selection component
     * @memberof RecordList
     * @instance
     * @type {CustomViewSelection}
     * @returns {CustomViewSelection} CustomViewSelection component instance
     * @example <caption>Sample</caption>
     * var view = zdk.components.record_list.custom_view_selection.getValue();
     */
    get custom_view_selection() { return new CustomViewSelection('root'); }
    /**
     * @summary Get the View Type Selection component
     * @memberof RecordList
     * @instance
     * @type {ViewTypeSelection}
     * @returns {ViewTypeSelection} ViewTypeSelection component instance
     * @example <caption>Sample</caption>
     * var viewType = zdk.components.record_list.view_type_selection.getValue();
     */
    get view_type_selection()   { return new ViewTypeSelection('root'); }
    /**
     * @summary Get the Page Selection component (for canvas/wizard page tabs)
     * @memberof RecordList
     * @instance
     * @type {PageSelection}
     * @returns {PageSelection} PageSelection component instance
     * @example <caption>Sample</caption>
     * var currentPage = zdk.components.record_list.page_selection.getValue();
     */
    get page_selection()        { return new PageSelection('root'); }
    /**
     * @summary Get the Notes Editor component
     * @memberof RecordList
     * @instance
     * @type {NotesEditor}
     * @returns {NotesEditor} NotesEditor component instance
     * @example <caption>Sample</caption>
     * var notes = zdk.components.record_list.notes_editor.getValue();
     */
    get notes_editor()          { return new NotesEditor('root'); }
  }

  // ── UI component classes (Loader, Popup, Flyout, Mailer) ────────────

  class Loader {
    static className = 'Loader';
    /**
     * @summary Show a loader overlay on the page.
     * @function
     * @memberof Loader
     * @param {String} message - text to be displayed
     * @param {Object} [options] - message options
     * @param {'info'|'error'|'warning'|'success'} [options.type=info] - type of message
     * @example <caption>Show Loader</caption>
     * wdk.components.loader.show({ type: 'page', template: 'standard' });
     * @example <caption>Show with message</caption>
     * wdk.components.loader.show({ type: 'page', template: 'dot-spinner', message: 'Saving...' });
     * @example <caption>Auto-hide after 2 seconds</caption>
     * wdk.components.loader.show({ type: 'page', template: 'spinner', timer: 2000 });
     */
    show(config) {
      config = config || {};
      if (config.template === '' || (config.template && !config.template.trim())) { throw new Error('Invalid Loader Template'); }
      config.type     = config.type     || 'page';
      config.template = config.template || 'standard';
      if (!['page'].includes(config.type)) { throw new TypeError('Invalid Loader Type'); }
      if (!['spinner', 'vertical-bar', 'standard', 'dot-spinner'].includes(config.template)) { throw new Error('Invalid Loader Template'); }
      if (config.message && config.message.length > 240) { throw new Error('Loader message must be atmost 240 characters'); }
      if (config.timer !== undefined && config.timer !== null) {
        if (typeof config.timer !== 'number' || isNaN(config.timer) || config.timer < 0) { throw new TypeError('timer must be a positive number'); }
        if (config.timer > 60000) { throw new Error('timer duration limit crossed - ' + config.timer + '. Maximum is 60000ms'); }
      }
      return ZDKResolver({ action: 'show_loader', type: config.type, template: config.template, message: config.message || '', timer: config.timer !== undefined ? config.timer : null }, { loading: config.template !== 'standard' });
    }
    /**
     * @summary Hide the active loader overlay.
     * @function
     * @memberof Loader
     * @example
     * wdk.components.loader.hide()
     */
    hide() { return ZDKResolver({ action: 'hide_loader' }, { loading: false }); }
  }

  class Popup {
    static className = 'Popup';
    /**
     * @summary Open a widget, slyteui or CRM page (record create/edit/detail form, record picker) in a popup and await a response. For widgets, the response is sent from the widget's wdk.components.popup.close()
     * @function
     * @memberof Popup
     * @param {Object} config - First argument. Identifies what to open in the popup
     * @param {'widget'|'slyteui'|'crux'} config.type - `widget` - Custom Button type widget `slyteui` - Slyte UI component `crux` - CRM page (record form, record detail or record picker)
     * @param {String} config.api_name - `widget` / `slyteui` - api name of the widget (Custom Button type) or slyteui `crux` - one of `record_create`, `record_edit`, `record_detail`, `record_clone` or `record-picker`
     * @param {Object} [config.crux] - Applicable only when `config.type` is `crux`. Options for the CRM page to open
     * @param {String} [config.crux.module] - API name of the module. Required for `record_create`, `record_edit`, `record_detail`, `record_clone` and `record-picker`. Activities, Events and Calls are not supported
     * @param {String} [config.crux.record_id] - id of the record. Required for `record_edit`, `record_detail` and `record_clone`. The record must exist in the given module
     * @param {Object} [config.crux.queryParams] - Key-value pairs appended as query parameters to the page URL. With `record_create`, use it to set create-time defaults or pass custom URL parameters
     * @param {String} [config.crux.canvas_id] - ID of the canvas view. When provided, the canvas-backed form or page is loaded instead of the standard one. Supported for `record_create`, `record_edit`, `record_clone` and `record_detail`. Pass it inside `crux`, alongside `module` and `record_id`
     * @param {Object} [options] - Second argument. Popup display options
     * @param {String} [options.header] - header for the popup `undefined` - hides the header (Default: ${widget|slyteui name})
     * @param {Boolean} [options.close_icon=true] - toggle close icon
     * @param {Boolean} [options.close_on_escape=false] - toggle close on Esc key
     * @param {1|2|3|4|5|6} [options.animation_type=1] - define the animation style of the popup `1` - slides popup from top `2` - slides popup from right `3` - slides popup from left `4` - slides popup from bottom `5` - fades in and fades out the popup `6` - zoom in and zoom out the popup
     * @param {'200px'|'20vh'} [options.height] - popup height (Default: '70vh')
     * @param {'500px'|'50vw'} [options.width] - popup width (Default: '60vw')
     * @param {'0'|'20px'|'center'} [options.top] - popup offset > top (Default: '0')
     * @param {'0'|'20px'|'center'} [options.left] - popup offset > left (Default: 'center')
     * @param {'0'|'20px'|'center'} [options.bottom] - popup offset > bottom (overrides top property)
     * @param {'0'|'20px'|'center'} [options.right] - popup offset > right (overrides left property)
     * @param {any} [data] - data to be passed as 'PageLoad' event data in Widget. For slyteui, can access the data inside the component. You can also pass the required data from here.
     * @returns {object|string|number|boolean} Response from widget's $Client.close()
     * @example <caption>Open a widget popup</caption>
     * wdk.components.popup.open({ api_name: 'sample_widget', type: 'widget' }, { header: 'Sample Widget', height: '450px', width: '450px' }, { data: 'sample' });
     * @example <caption>Positioned popup with animation</caption>
     * wdk.components.popup.open({ api_name: 'sample_widget', type: 'widget' }, { header: 'Sample Widget', animation_type: 6, height: '60vh', width: '50vw', top: '10px' });
     * @example <caption>Open the create form of a module in popup</caption>
     * wdk.components.popup.open({ type: 'crux', api_name: 'record_create', crux: { module: 'Leads' } });
     * @example <caption>Open the create form with default values and popup options</caption>
     * wdk.components.popup.open({ type: 'crux', api_name: 'record_create', crux: { module: 'Leads', queryParams: { Last_Name: 'Test' } } }, { header: 'Create Lead', height: '80vh', width: '60vw' });
     * @example <caption>Open a canvas create form and pass runtime data</caption>
     * wdk.components.popup.open({ type: 'crux', api_name: 'record_create', crux: { module: 'Leads', canvas_id: '111111000000069302' } }, { header: 'Create Lead' }, { data: 'sample' });
     * @example <caption>Open a record picker (CRUX) popup with criteria</caption>
     * wdk.components.popup.open({ api_name: 'record-picker', type: 'crux', crux: { module: 'Leads', multiple: true, cvid: '123456789', criteria: { group_operator: 'OR', group: [ { group_operator: 'AND', group: [ { comparator: 'contains', field: { api_name: 'Name' }, value: 'Test' }, { comparator: 'not_contains', field: { api_name: 'Name' }, value: '2' } ] }, { comparator: 'contains', field: { api_name: 'Email' }, value: 'testrec21@gmail.com' } ] } }, { header: 'Sample Records', animation_type: 4, height: '100vh', width: '75vw', left: '10px' });
     * @example <caption>Open the record edit form in popup</caption>
     * wdk.components.popup.open({ type: 'crux', api_name: 'record_edit', crux: { module: 'Leads', record_id: '11000000068396' } });
     * @example <caption>Open the record detail page in popup</caption>
     * wdk.components.popup.open({ type: 'crux', api_name: 'record_detail', crux: { module: 'Leads', record_id: '11000000068396' } });
     * @example <caption>Open the record detail page in a canvas view</caption>
     * wdk.components.popup.open({ type: 'crux', api_name: 'record_detail', crux: { module: 'Leads', record_id: '11000000068396', canvas_id: '52180000001234567' } });
     * @example <caption>Open the record clone form in popup</caption>
     * wdk.components.popup.open({ type: 'crux', api_name: 'record_clone', crux: { module: 'Leads', record_id: '11000000068396' } });
     */
    open(widget, config, data) {
      var type = widget.type, api_name = widget.api_name, id = widget.id, crux = widget.crux;
      var widgetConfig = {};
      if (widget && typeof widget === 'object') {
        Object.keys(widget).forEach(function (key) {
          if (!['type', 'api_name', 'id', 'crux'].includes(key)) {
            widgetConfig[key] = widget[key];
          }
        });
      }
      var popupConfig = Object.assign({}, widgetConfig, config || {});
      if (!['widget', 'crux', 'slyteui', 'kiosk'].includes(type)) { throw new Error('unsupported popup type: ' + type); }
      if (type === 'crux' && !['record_create', 'record_edit', 'record_detail', 'record_clone', 'record-picker'].includes(api_name)) {
        throw new Error('unsupported crux type: ' + api_name);
      }
      return ZDKResolver({ action: 'open_popup', id, type, api_name, crux, config: popupConfig, data }, { userInput: true });
    }
    // config(config) { return ZDKResolver({ action: 'update_popup_config', config }); }
    /**
     * @summary Close the currently open popup. It also closes custom buttons, blueprints and other overlays opened as widget.
     * @function
     * @memberof Popup
     * @param {Object} config
     * @param {Boolean} config.refresh - refresh the page after closing the popup
     * @param {String} response - response to be sent back to the caller
     * @example
     * wdk.components.popup.close({ refresh: true })
     */
    close(config, response)  { return WDKCompat.popupClose(config || {}, response || {}); }
  }

  class Flyout {
    static className = 'Flyout';
    #name;
    constructor(name) { this.#name = name; }
    /**
     * @summary Open a Widget in this Flyout. Note: The presence of an active loader restricts the availability of other pop-ups.
     * @function
     * @memberof Flyout
     * @param {String} name - flyout name
     * @param {Object} [config]
     * @param {String} [config.header] - header for the flyout (Default: ${widget|slyteui name})
     * @param {Boolean} [config.close_icon=true] - toggle close icon
     * @param {Boolean} [config.close_on_exit=true] - To keep/close flyout on page navigation
     * @param {1|2|3|4|5|6} [config.animation_type=1] - define the animation style of the flyout `1` - slides flyout from top `2` - slides flyout from right `3` - slides flyout from left `4` - slides flyout from bottom `5` - fades in and fades out the flyout `6` - zoom in and zoom out the flyout
     * @param {'200px'|'20vh'} [config.height] - flyout height (Default: '40vh')
     * @param {'500px'|'50vw'} [config.width] - flyout width (Default: '20vw')
     * @param {'0'|'20px'|'center'} [config.top] - flyout offset > top (Default: '20px')
     * @param {'0'|'20px'|'center'} [config.left] - flyout offset > left (Default: 'center')
     * @param {'0'|'20px'|'center'} [config.bottom] - flyout offset > bottom (overrides top property)
     * @param {'0'|'20px'|'center'} [config.right] - flyout offset > right (overrides left property)
     * @returns {Flyout} {@link Flyout} object
     * @example <caption>Open with config</caption>
     * wdk.components.flyout('myFlyout').open({ api_name: 'sample_widget', type: 'widget' }, { header: 'Sample', animation_type: 4, height: '60vh', width: '30vw' });
     * @example <caption>Open with data</caption>
     * wdk.components.flyout('myFlyout').open({ api_name: 'sample_widget', type: 'widget' }, { header: 'Sample' }, { data: 'sample' });
     */
    open(widget, config, data) {
      var type = widget && widget.type;
      if (type && !['widget', 'kiosk', 'slyteui'].includes(type)) { throw new Error('unsupported Flyout type: ' + type); }
      return WDKCompat.flyoutOpen(this.#name, widget, config, data);
    }
    /**
     * @summary Close this Flyout.
     * @function
     * @memberof Flyout
     * @example
     * wdk.components.flyout('myFlyout').close()
     */
    close()        { return ZDKResolver({ action: 'close_flyout',         name: this.#name }); }
    // config(config) { return ZDKResolver({ action: 'update_flyout_config', name: this.#name, config }); }
    /**
     * @summary Notify Flyout and optionally await a response from the Widget. Moreover, custom data can be listened from widget through 'Notify' event. If options.wait is true, data can be listened through 'NotifyAndWait' event. Note: The 'Notify' is not supported for components.
     * @function
     * @memberof Flyout
     * @param {Any} data - data can be listened through Notify / NotifyAndWait event in Widget
     * @param {Object} [options]
     * @param {String} [options.wait] - true/false - wait for response from Widget
     * @returns {Any} Response from Widget's wdk.components.flyout.sendResponse if options.wait is true
     * @example
     * wdk.components.flyout('myFlyout').notify({ data: 'sample data' }, { wait: true })
     */
    notify(data, options) {
      return ZDKResolver({ action: 'notify_flyout', name: this.#name, data: data, config: options }, { userInput: true });
    }
    /**
     * @summary Send response to widget
     * @function
     * @memberof Flyout
     * @param {Any} data - response to be passed
     * @param {String} [request_uuid] - Unique ID received in the NotifyAndWait event of the flyout widget
     * @returns {Any} Response from Widget's wdk.components.flyout.sendResponse if options.wait is true
     * @example
     * wdk.components.flyout.sendResponse(data.id, { email: 'sample mail' })
     */
    sendResponse(request_id, data) {
      return ZDKResolver({ action: 'notify_response', message: { data, uuid: request_id } }, { userInput: true });
    }
  }

  class Mailer {
    static className = 'Mailer';
    /**
     * @summary Open the email composer with pre-filled values.
     * @function
     * @memberof Mailer
     * @param {Object} mail_config - Configuration for send mail form
     * @param {string} mail_config.from - from address
     * @param {Array.<Object>} mail_config.to - to address
     * @param {Array.<Object>} mail_config.cc - cc address
     * @param {string} mail_config.subject - email subject
     * @param {string} mail_config.body - email body
     * @param {string} mail_config.templateId - email template id
     * @example <caption>Sample</caption>
     * wdk.components.mailer.open({ from: 'example@zoho.com', to: [{ email: 'zylker@zyldomain.com', label: 'Zylker' }], subject: 'Hello' });
     * @example <caption>With CC and body</caption>
     * wdk.components.mailer.open({ from: 'me@zoho.com', to: [{ email: 'a@b.com', label: 'A' }], cc: [{ email: 'c@d.com', label: 'C' }], subject: 'Update', body: 'Hi there' });
     * @example <caption>Using a template</caption>
     * wdk.components.mailer.open({ from: 'me@zoho.com', to: [{ email: 'a@b.com', label: 'A' }], subject: 'Welcome', templateId: '1234567890' });
     */
    open(mail_config) { return ZDKResolver({ action: 'open_mailer', mail_config }); }
  }

  // ── 6. Build the `wdk` namespace ─────────────────────────────────────────────

  // In iframe context ZDKResolver returns a Promise; ?.prop on a Promise gives undefined.
  // This helper chains .then() for the iframe path, or reads the prop directly (CScript).
  function _getUserProp(prop) {
    var p = ZDKResolver({ action: 'variable', key: 'user' });
    if (p && typeof p.then === 'function') { return p.then(function (u) { return u && u[prop]; }); }
    return p && p[prop];
  }

  // ── wdk.user ─────────────────────────────────────────────────────────────────
  /**
   * @namespace wdk.user
   * @summary Logged-in user properties and UI dialog helpers.
   * @description Mirrors the zdk.user surface. Includes `mode` as a WDK host enrichment.
   */
  var wdk_user = {
    /**
     * @summary The unique ID of the current user.
     * @instance
     * @memberof wdk.user
     * @returns {Promise} user id
     * @example
     * wdk.user.id.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * "5276272000000364001"
     */
    get id()          { return _getUserProp('id'); },
    /**
     * @summary The Zoho single sign-on user ID (ZUID).
     * @instance
     * @memberof wdk.user
     * @returns {Promise} user zuid
     * @example
     * wdk.user.zuid.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * "714939747"
     */
    get zuid()        { return _getUserProp('zuid'); },
    /**
     * @summary The full display name of the current user.
     * @instance
     * @memberof wdk.user
     * @returns {Promise} user full name
     * @example
     * wdk.user.full_name.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * "Henry R"
     */
    get full_name()   { return _getUserProp('full_name'); },
    /**
     * @summary The first name of the current user.
     * @instance
     * @memberof wdk.user
     * @returns {Promise} user first name
     * @example
     * wdk.user.first_name.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * "Henry"
     */
    get first_name()  { return _getUserProp('first_name'); },
    /**
     * @summary The last name of the current user.
     * @instance
     * @memberof wdk.user
     * @returns {Promise} user last name
     * @example
     * wdk.user.last_name.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * "R"
     */
    get last_name()   { return _getUserProp('last_name'); },
    /**
     * @summary The email address of the current user.
     * @instance
     * @memberof wdk.user
     * @returns {Promise} user email
     * @example
     * wdk.user.email.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * "henry@zylker.com"
     */
    get email()       { return _getUserProp('email'); },
    /**
     * @summary The preferred date format for the current user.
     * @instance
     * @memberof wdk.user
     * @returns {Promise} user date format
     * @example
     * wdk.user.date_format.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * "MMM d, yyyy"
     */
    get date_format() { return _getUserProp('date_format'); },
    /**
     * @summary The role assigned to the current user.
     * @instance
     * @memberof wdk.user
     * @returns {Promise} user role
     * @example
     * wdk.user.role.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * { 'id': "111111000000000706", 'name': "CEO" }
     */
    get role()        { return _getUserProp('role'); },
    /**
     * @summary The profile assigned to the current user.
     * @instance
     * @memberof wdk.user
     * @returns {Promise} user profile
     * @example
     * wdk.user.profile.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * { 'id': "111111000000000423", 'name': "Administrator" }
     */
    get profile()     { return _getUserProp('profile'); },
    /**
     * @summary The type of the current user account.
     * @instance
     * @memberof wdk.user
     * @returns {Promise} user type
     * @example
     * wdk.user.type.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * "Regular User" or "Client Portal User"
     */
    get type()        { return _getUserProp('type'); },
    /**
     * @summary The current user interface mode (for example, Day or Night).
     * @instance
     * @memberof wdk.user
     * @returns {String} user mode
     * @example
     * wdk.user.mode;
     * @example <caption>Output</caption>
     * "Day" | "Night"
     */
    get mode()        { return _getUserProp('mode'); },

    /**
     * @summary Show a toast message in Page with following markdown support.
     * @description Note: The presence of an active loader restricts the availability of other pop-ups. Image Markdown not supported for message.
     *
     *
     * Italics       - _text_
     *
     * Bold        - *text*
     *
     * Underline   - __text__
     *
     * Strikeout   - ~text~
     *
     * Code        - `text`
     *
     * Heading1    - # text
     *
     * Heading3    - ### text
     *
     * Blockquote  - !text
     *
     * Hyperlink   - [click here](https://www.zoho.com)
     * @function
     * @memberof wdk.user
     * @param {String} message - text to be displayed
     * @param {Object} [options] - message options
     * @param {'info'|'error'|'warning'|'success'} [options.type=info] - type of message
     * @returns {Promise} resolves when the message is displayed
     * @example
     * wdk.user.message('This is an *important* warning.', { type: 'warning', duration: 4000 }).then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * true| false
     */
    message: function (message, options) {
      if (options && options.duration && (options.duration > 100000 || options.duration < 500)) {
        throw new TypeError('duration should be in range 500 to 100000 ms');
      }
      if (typeof message === 'string' || message instanceof String) {
        return ZDKResolver({ action: 'msg_band', type: (options && options.type) ? options.type : 'info', message, duration: (options && options.duration) ? options.duration : 4000 });
      }
      throw new TypeError('First argument must be a String');
    },

    /**
     * @summary Note: The presence of an active loader restricts the availability of other pop-ups.
     * @description Show Alert message with markdown support.
     * @function
     * @memberof wdk.user
     * @param {String} message - primary text to be displayed
     * @param {String} [heading] - heading to be displayed
     * @param {String} [accept_message=Okay] - accept button message
     * @returns {Promise} resolves when the message is displayed
     * @example <caption>Simple Alert</caption>
     * wdk.user.alert('First Name will be mandatory from next week').then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Customised Alert with link, heading and button message</caption>
     * wdk.user.alert('You can [click here](https://www.zylker.com) to visit the page.', 'Got it!', { type: 'success', heading: 'Notice' }).then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Alert with bold, break and underline</caption>
     * wdk.user.alert('This is an __important__ message\n This is an *important* message').then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Alert with image</caption>
     * wdk.user.alert('![alt text](https://link-to/sample.png)').then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * true | false
     */
    alert: function (message, accept_message, options) {
      validator(accept_message, 'accept_message', { max_length: 15, min_length: 1, required: false });
      validator(options && options.heading, 'heading', { max_length: 200, min_length: 1, required: false });
      if (options && options.type && !['info', 'error', 'warning', 'success'].includes(options.type)) {
        throw new TypeError('unsupported type : ' + options.type);
      }
      if (typeof message === 'string' || message instanceof String) {
        return ZDKResolver({ action: 'alert', type: (options && options.type) ? options.type : 'info', message, heading: options && options.heading, accept_message }, { userInput: true });
      }
      throw new TypeError('First argument must be a String');
    },

    /**
     * @summary Show confirmation box with markdown support and accept/reject message.
     * @description Note: The presence of an active loader restricts the availability of other pop-ups.
     * @function
     * @memberof wdk.user
     * @param {String} message - text to be displayed
     * @param {String} [accept_message] - accept button message (Default: Yes, Proceed)
     * @param {String} [reject_message=Cancel] - reject button message
     * @returns {Promise} confirmation response
     * @example <caption>Simple Confirmation Box</caption>
     * wdk.user.confirm('Are you sure?').then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Customised Confirmation Box</caption>
     * wdk.user.confirm('Are you *sure*?', 'Yes. Got it!', 'Nope').then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * true | false
     */
    confirm: function (message, accept_message, reject_message, options) {
      validator(accept_message, 'accept_message', { max_length: 15, min_length: 1, required: false });
      validator(reject_message, 'reject_message', { max_length: 15, min_length: 1, required: false });
      if (options && options.type && !['info', 'error', 'warning', 'success'].includes(options.type)) {
        throw new TypeError('unsupported type : ' + options.type);
      }
      if (typeof message === 'string' || message instanceof String) {
        return ZDKResolver({ action: 'confirm', accept_message, reject_message, acceptMsg: accept_message, rejectMsg: reject_message, heading: (options && options.heading) ? options.heading : '', type: (options && options.type) ? options.type : '', message }, { userInput: true });
      }
      throw new TypeError('First argument must be a String');
    },

    /**
     * @summary Get one or more input.
     * @description Note: The presence of an active loader restricts the availability of other pop-ups.
     * @function
     * @memberof wdk.user
     * @param {Object} options
     * @param {Array.<Object>} [options.type] - Max Value Limit Input options - 7 `text` - 120 characters `number` - 50 digits `textarea` - 2000 characters `picklist options` - 500 options (each option - 120 characters) (Default: 'text')
     * @param {String} [options.label] - label for input field
     * @param {String} [options.default_value]
     * @param {Array.<Object>} [options.list_options] - list of options for picklist
     * @param {String} [heading] - Heading
     * @param {String} [accept_message=Okay] - accept button message
     * @param {String} [reject_message=Cancel] - reject button message
     * @returns {Object} Get input response
     * @example <caption>Text Input</caption>
     * wdk.user.input([{ type: 'number', label: 'Enter No. of employees' }, { type: 'text', label: 'Enter batch name' }], 'Employees', 'OK', 'Cancel');
     * @example <caption>Default value sample</caption>
     * wdk.user.input([{ type: 'textarea', label: 'Enter batch name', default_value:'sample' }], 'Employees', 'OK', 'Cancel');
     * @example <caption>For picklist,</caption>
     * wdk.user.input([{ type: 'picklist', label: 'Enter branch', list_options: [{ actual_value: "Sales", display_value: "Sales Department" }, { actual_value: "HR", display_value: "HR Department" }], default_value:"HR" }], 'Employees', 'OK', 'Cancel');
     * @example <caption>Output</caption>
     * ['120', 'Batch A']
     * @example <caption>Output</caption>
     * ['sample']
     * @example <caption>Output</caption>
     * ['HR']
     */
    input: function (options, accept_message, reject_message, dialog) {
      if (options) {
        if (!Array.isArray(options)) { throw new TypeError('options should be an array'); }
        if (options.length > 10) { throw new Error('Max input limit of 10 reached'); }
        options.forEach(function (option) {
          var allowed = ['text', 'number', 'textarea', 'picklist', 'multiselectpicklist', 'date', 'dateandtime', 'checkbox', 'radiobutton', 'email', 'dropdown', 'twitter', 'lookup'];
          if (!allowed.includes(option.type)) { throw new TypeError('unsupported field type : ' + option.type); }
          validator(option.label, "'label' in '" + option.type + "' type", { max_length: 30, min_length: 1, required: true });
          if (option.placeholder !== undefined)  { validator(option.placeholder,  'placeholder',  { max_length: 30, required: false }); }
          if (option.info_message !== undefined) { validator(option.info_message, 'info_message', { max_length: 30, required: false, allow_null: true }); }
          if (option.title !== undefined)        { validator(option.title,        'title',        { max_length: 30, required: false, allow_null: true }); }
          if (option.required !== undefined && typeof option.required !== 'boolean') {
            throw new TypeError("'required' must be a boolean");
          }
          if (option.max !== undefined && typeof option.max !== 'number') {
            throw new TypeError("'max' must be a Number");
          }
          if (option.min !== undefined && typeof option.min !== 'number') {
            throw new TypeError("'min' must be a Number");
          }
        });
      }
      var heading = dialog && dialog.heading;
      validator(heading, 'heading', { max_length: 30, min_length: 1, required: false });
      var is_limit = accept_message && accept_message.length > 40;
      if (reject_message && reject_message.length > 40 || is_limit) {
        throw new Error((is_limit ? 'accept_message' : 'reject_message') + ' must be atmost 40 characters');
      }
      return ZDKResolver({ action: 'get_input', options, accept_message, reject_message, heading }, { userInput: true });
    }
  };

  // ── wdk.app ──────────────────────────────────────────────────────────────────
  // AppHandler.js exposes individual variable keys: 'org', 'environment', 'deployment'.
  // There is no 'app_context' aggregate key in the handler — using it returns nothing.
  // Platform is detected locally to match the ZDK-2.0.ts contract when the host
  // does not provide an explicit app context variable for it.
  // wdk.app.user is intentionally absent — use wdk.user.* per ZDK-2.0.ts spec.
  /**
   * @namespace wdk.app
   * @summary Application context accessors and host notification entry point.
   */
  var wdk_app = {
    /**
     * @summary The organisation details of the current org.
     * @instance
     * @memberof wdk.app
     * @returns {Promise} org object
     * @example
     * wdk.app.org.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * {
     *   'type': "production",
     *   'domain_name': "org77591XXXX",
     *   'name': "Zoho",
     *   'id': "77591XXXX"
     * }
     */
    get org()         { return ZDKResolver({ action: 'variable', key: 'org' }); },
    /**
     * @summary The present environment: 'production' for the live org, 'sandbox' for the sandbox org, and null when accessed from Client Portal.
     * @instance
     * @memberof wdk.app
     * @returns {Promise} environment of the app
     * @example
     * wdk.app.environment.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * "production" or "sandbox" or null
     */
    get environment() { return ZDKResolver({ action: 'variable', key: 'environment' }); },
    /**
     * @summary The present platform where the widget runs: 'web', 'mobile', or 'mobile_application'.
     * @instance
     * @memberof wdk.app
     * @returns {String} platform where the widget runs
     * @example
     * wdk.app.platform;
     * @example <caption>Output</caption>
     * "web"
     */
    get platform() {
      var isMobilePlatform = self && self.mobilePlatform && String(self.mobilePlatform).trim().length > 0;
      if (isMobilePlatform) { return 'mobile_application'; }
      var nav = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav && (nav.userAgent.includes('wv') || ((new RegExp('iphone|ipad|ipod', 'i')).test(nav.userAgent) && !nav.standalone && !(new RegExp('safari', 'i')).test(nav.userAgent)))) {
        return 'mobile_application';
      }
      if (nav && (new RegExp('iPhone|iPad|iPod|Android|webOS|Opera Mini|BlackBerry|Windows Phone', 'i')).test(nav.userAgent)) {
        return 'mobile';
      }
      return 'web';
    },
    /**
     * @summary The deployment data center code for the current organisation. Possible codes: US, EU, IN, CN, AU, JP, CA, SA, UAE, SG
     * @instance
     * @memberof wdk.app
     * @returns {Promise} deployment data center code for the current org
     * @example
     * wdk.app.deployment.then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * "US"
     */
    get deployment()  { return ZDKResolver({ action: 'variable', key: 'deployment' }); },
    /**
     * @summary Navigate to record's detail page, create page, list view etc.,
     * @function
     * @memberof wdk.app
     * @param {'tab'|'record_detail'|'record_create'|'record_clone'|'record_edit'|'record_list'} page - `tab` - Web Tab / Default list view page `record_create` - Record create page `record_edit` - Record edit page `record_detail` - Record detail page `record_clone` - Record clone page `record_list` - Listview Page
     * @param {object} params
     * @param {string} params.module - api name of the module
     * @param {string} [params.record_id] - id of the record
     * @param {string} [params.layout_id] - id of the layout
     * @param {string} [params.custom_view_id] - custom view id of the page (Default: ${default})
     * @param {object} data - `Web tab`- data to be passed to the widgets and get the data from 'PageLoad' event of widgets. `Other Pages` -  can pass custom data when navigating from one page to another and then access that data on the target page. - To retrieve navigation data, 'wdk.page.getNavigationData();' can be used.
     * @param {'_blank'|'_self'} [target=_self] - `_self` - open in same tab `_blank` - open in new tab
     * @returns {Promise} resolves with true|false
     * @example <caption>Navigate to record detail</caption>
     * wdk.app.navigate('record_detail', { module: 'Leads', record_id: '11111023162335' }).then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Navigate to list page in a new tab</caption>
     * wdk.app.navigate('record_list', { module: 'Leads' }, '_blank').then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Open record detail in canvas view</caption>
     * wdk.app.navigate('record_detail', {
     *   module: 'Leads',
     *   record_id: '11111023162335',
     *   view: { type: 'canvas', id: '11111023162335' }
     * }).then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Pass custom navigation data</caption>
     * wdk.app.navigate('record_detail', {
     *   module: 'Leads',
     *   record_id: '11111023162335',
     *   custom_data: { from: 'dashboard' }
     * }).then(function(data){
     *   console.log(data);
     * });
     */
    navigate: function (page, params, target, data) {
      var isSetupPage = typeof page === 'string' && page.trim().toLowerCase() === 'setup';
      if (isSetupPage) {
        validator((params && params.api_name) || '', 'params.api_name', { required: true });
      } else {
        validator((params && params.module) || '', 'params.module', { required: true });
      }
      return ZDKResolver({ action: 'route_navigate', page, params, data, target });
    },
    /**
     * @summary Register a listener for a system event. The callback receives event data when the event fires.
     * @function
     * @memberof wdk.app
     * @example
     * // Subscribe to PageLoad before using the widget
     * await wdk.app.on('PageLoad', function(data) {
     *   console.log(data);
     * });
     *
     * // Subscribe to synchronous flyout notifications
     * await wdk.app.on('NotifyAndWait', function(data) {
     *   console.log('Client Script synchronous flyout notification', data);
     * });
     * @example <caption>Output</caption>
     * // PageLoad event payload
     * {
     *   Entity: 'Leads',
     *   EntityId: '3000000032096'
     * }
     */
    on: function (event, callback) {
      if (!event || typeof event !== 'string' || !event.trim()) {
        throw new TypeError('event must be a non-empty string');
      }
      if (typeof callback !== 'function') {
        throw new TypeError('callback must be a Function');
      }

      event = event.trim();

      // Widget iframe path: Event.Listen is a local array-push inside ZSDKEventManager—
      // no postMessage is ever sent, safe to call at any time before or after SET_CONTEXT.
      if (typeof self._getAppSDK === 'function') {
        return self._getAppSDK().getContext().Event.Listen(event, callback);
      }

      // CScript / generic event bus fallback (no ZSDK instance available)
      return ZDKResolver({
        action: 'event_add_listener',
        eventName: event,
        callback: callback,
        options: { origin: '*' }
      });
    },
    /**
     * @summary Notify an event to CRM app from widget (for example, to trigger a blueprint transition to proceed, or to resize the widget component).
     * @function
     * @memberof wdk.app
     * @param {String} event - Event name to notify
     * @param {Object} data - Dimension for the widget
     * @param {String} data.height - Height in px|%|vh
     * @param {String} data.width - Width in px|%|vw
     * @returns {Promise} true if the notification was successful
     * @example <caption>Resize Widget to the given dimensions</caption>
     * wdk.app.notify('component.resize', { height: '100px', width: '350px' }).then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Perform blueprint transition to move to next state</caption>
     * await wdk.app.notify('blueprint.proceed');
     * @example <caption>Output</caption>
     * true
     */
    notify: function (event, data) {
      if (!event || typeof event !== 'string' || !event.trim()) {
        throw new TypeError('event must be a non-empty string');
      }
      var normalizedEvent = event.trim();
      return ZDKResolver({ action: 'app_notify', event: normalizedEvent, data: data }, { userInput: true });
    }
  };

  // ── wdk.page ─────────────────────────────────────────────────────────────────
  /**
   * @namespace wdk.page
   * @summary Page context, refresh, and freeze helpers.
   */
  var wdk_page = {
    /**
     * @summary Get custom navigation data passed from wdk.app.navigate() method
     * @function
     * @memberof wdk.page
     * @returns {Promise} Custom Data
     * @example <caption>Sample for navigating to List page</caption>
     * wdk.app.navigate('record_list', { module: 'Leads', custom_view_id: '111111000000046541', custom_data: [{ key: "value"}] }, '_self');
     * @example <caption>To get navigation data in List page</caption>
     * wdk.page.getNavigationData().then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Output</caption>
     * {
     *  key: "value",
     *  ...
     * }
     */
    getNavigationData: function () {
      return ZDKResolver({ action: 'navigation_data' });
    },
    /**
     * @summary Get the name from the page information response
     * @function
     * @returns {String|undefined} Page name; undefined when the resolver returns a Promise
     * @example <caption>Sample</caption>
     * var pageName = await wdk.page.getName();
     */
    getName: function () {
      return ZDKResolver({ action: 'page_info', config: { include_module_apiname: true } })?.name;
    },
    /**
     * @summary Soft-refresh the current page.
     * @function
     * @memberof wdk.page
     * @param {Object} config - configuration
     * @param {Boolean} [config.triggerOnLoad=false] - to trigger onLoad event of that page
     * @returns {Promise} refresh response
     * @example <caption>Sample 1</caption>
     * wdk.page.refresh().then(function(data){
     *   console.log(data);
     * });
     * @example <caption>Sample 2</caption>
     * wdk.page.refresh({triggerOnLoad: true}).then(function(data){
     *   console.log(data);
     * });
     */
    refresh: function (config) {
      return ZDKResolver({ action: 'refresh_page', config: config || { triggerOnLoad: false } }, { userInput: true });
    },
    /**
     * @summary Freeze or unfreeze the UI.
     * @function
     * @memberof wdk.page
     * @param {Boolean} value - freeze the UI(true/false)
     * @returns {Promise} freeze response
     * @example
     * wdk.page.freeze(true).then(function(data){
     *   console.log(data);
     * });
     */
    freeze: function (flag) {
      return ZDKResolver({ action: flag ? 'freeze' : 'unfreeze' });
    }
  };

  // ── wdk.client ────────────────────────────────────────────────────────────────
  /**
   * @namespace wdk.client
   * @summary Browser/client utility helpers (url, openURL, download, clipboard, geolocation).
   */
  var wdk_client = {};

  /**
   * @summary Get the current page URL.
   * @instance
   * @memberof wdk.client
   * @returns {String} Client url
   * @example
   * wdk.client.url;
   * @example <caption>Output</caption>
   * 'https://crm.zoho.com/crm/org123/Leads'
   */
  Object.defineProperty(wdk_client, 'url', {
    get: function () { return (self.location && self.location.href) || ''; },
    enumerable: true, configurable: true
  });

  /**
   * @summary Open a new browser window or tab with the specified URL.
   * @function
   * @memberof wdk.client
   * @param {String} [url] - url of the page to be openend
   * @param {String} [target=_blank] - Browsing context: _blank (new tab) or _self (same tab). Defaults to _blank
   * @returns {Promise} open URL response
   * @example <caption>Open URL in a new tab</caption>
   * wdk.client.openURL('https://www.zoho.com', '_blank').then(function(data){
   *   console.log(data);
   * });
   * @example <caption>Open URL in the same tab</caption>
   * wdk.client.openURL('https://www.zoho.com', '_self').then(function(data){
   *   console.log(data);
   * });
   */
  wdk_client.openURL = function (url, target) {
    if (!url || typeof url !== 'string' || !url.trim()) {
      throw new TypeError('url must be a non-empty String');
    }
    if (target && target !== '_blank' && target !== '_self') {
      throw new TypeError("target must be '_blank' or '_self'");
    }
    return ZDKResolver({ action: 'open_window', url, target });

  };

  /**
   * @summary Copy text to the clipboard.
   * @function
   * @memberof wdk.client
   * @param {string} text - Text to copy
   * @returns {Promise} copy response
   * @example <caption>Sample</caption>
   * wdk.client.copyToClipboard('1234567890').then(function(data){
   *   console.log(data);
   * });
   */
  wdk_client.copyToClipboard = function (text) {
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new TypeError('text must be a non-empty String');
    }
    if (text.length > 10000) {
      throw new RangeError('text must be at most 10000 characters');
    }
    return ZDKResolver({ action: 'copy_clipboard', text: text });
  };

  /**
   * @summary Retrieve the device's current geographic position.
   * @function
   * @memberof wdk.client
   * @returns {Promise} location object
   * @example <caption>Sample</caption>
   * wdk.client.geoLocation().then(function(data){
   *   console.log(data);
   * });
   * @example <caption>Output</caption>
   * {
   *   'latitude': 8.894601,
   *   'longitude': 77.343917,
   *   'accuracy': 1255.38,
   *   'altitude': null,
   *   'altitudeAccuracy': null,
   *   'heading': null,
   *   'speed': null
   * }
   */
  wdk_client.geoLocation = function (options) {
    // AppHandler.js handles 'geolocation' as a variable key, not 'geolocation_get_current'.
    // userInput: true because getCurrentPosition requires a browser permission prompt.
    return ZDKResolver({ action: 'variable', key: 'geolocation' }, { userInput: true });
  };

  /**
   * @summary Get text selected by the user on the current page.
   * @function
   * @memberof wdk.client
   * @returns {Promise} selected text response
   * @example <caption>Sample</caption>
   * wdk.client.getSelectedText().then(function(data){
   *   console.log(data);
   * });
   * @example <caption>Output</caption>
   * { 'value': "Selected Text" }
   */
  wdk_client.getSelectedText = function () {
    return ZDKResolver({ action: 'variable', key: 'selectedValue' });
  };

  /**
   * @summary Returns whether the browser tab hosting the CRM page is currently active (visible and focused).
   * @function
   * @memberof wdk.client
   * @returns {Boolean} whether the browser tab is active
   * @example <caption>Sample</caption>
   * wdk.client.isActive().then(function(data){
   *   console.log(data);
   * });
   * @example <caption>Output</caption>
   * true
   */
  wdk_client.isActive = function () {
    return ZDKResolver({ action: 'variable', key: 'is_tab_active' });
  };

  // ── wdk.components ────────────────────────────────────────────────────────────
  var wdk_components = {};

  ['record_form', 'record_detail', 'record_list'].forEach(function (key) {
    var Ctor = key === 'record_form'         ? RecordForm
             : key === 'record_detail'       ? RecordDetail
             : RecordList;
    Object.defineProperty(wdk_components, key, {
      get: function () {
        var defaultInstance = new Ctor();
        var fn = function (module) { return new Ctor(module); };
        // Object.assign(fn, instance) only copies own enumerable props — prototype methods
        // (field, getInfo, getValues, buttons, etc.) are on the prototype, not own props.
        // Walk the prototype chain and copy all methods/getters onto fn.
        var proto = Ctor.prototype;
        while (proto && proto !== Object.prototype) {
          var names = Object.getOwnPropertyNames(proto);
          for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (name === 'constructor' || fn[name] !== undefined) { continue; }
            var desc = Object.getOwnPropertyDescriptor(proto, name);
            if (!desc) { continue; }
            if (typeof desc.get === 'function') {
              // Getter property (e.g. page_selection, layout_selection, notes_editor)
              Object.defineProperty(fn, name, {
                get: desc.get.bind(defaultInstance),
                enumerable: desc.enumerable, configurable: true
              });
            } else if (typeof desc.value === 'function') {
              fn[name] = desc.value.bind(defaultInstance);
            }
          }
          proto = Object.getPrototypeOf(proto);
        }
        return fn;
      },
      enumerable: true, configurable: true
    });
  });

  Object.defineProperty(wdk_components, 'loader',  { value: new Loader(),                                   enumerable: true, configurable: true });
  Object.defineProperty(wdk_components, 'popup',   { value: new Popup(),                                    enumerable: true, configurable: true });

  var flyoutFactory = function (name) { return new Flyout(name); };
  flyoutFactory.sendResponse = function (request_id, data) {
    return new Flyout().sendResponse(request_id, data);
  };
  Object.defineProperty(wdk_components, 'flyout', { value: flyoutFactory, enumerable: true, configurable: true });

  Object.defineProperty(wdk_components, 'mailer',  { value: new Mailer(),                                   enumerable: true, configurable: true });

  // ── Assemble wdk ──────────────────────────────────────────────────────────────
  var wdk = {
    version: '1.0',
    user:       wdk_user,
    app:        wdk_app,
    page:       wdk_page,
    client:     wdk_client,
    components: wdk_components
  };

  global.wdk = wdk;

  // ── Bootstrap: wire up route-sync once the widget iframe handshake completes ──
  function bootstrap() {
    if (typeof self._getAppSDK !== 'function') {
      return;
    }
    appSDK = self._getAppSDK();
    appSDK.OnLoad(function () {
      _startRouteSync();
    });
  }

  bootstrap();

})(typeof self !== 'undefined' ? self : window);
