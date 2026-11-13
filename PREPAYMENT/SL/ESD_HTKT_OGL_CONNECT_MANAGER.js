var EsdOglConnectManager;
var Class = lib.smis_Prototype.getClass();
EsdOglConnectManager = Class.create(lib.smis_Manager.getClass(), {

    initialize: function(configItem) {},
    isScheduleBased: function() {
        return true;
    },
    preProcess: function(task) { return ReturnCode.SUCCESS; },
    getAction: function() {
        return this.action;
    },

    getDestObj: function() {
        //return this.obj;
    },
    process: function(task) { return ReturnCode.SUCCESS; },
    postProcess: function(task, processStatusCode) {},
    errorHandling: function(errorCode, task) {},

});

function getClass() {
    return EsdOglConnectManager;
}