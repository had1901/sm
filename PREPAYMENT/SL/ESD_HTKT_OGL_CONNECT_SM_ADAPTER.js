var Class = lib.smis_Prototype.getClass();

var EsdOglConnectSMAdapter = Class.create({

    initialize: function(configItem) {
        this.configItem = configItem;
        this.logger = configItem.getLogger();
        this.instanceName = configItem.name;

    },

    getRecords: function() {
        var records = [];
        return records;
    },

    // return action code
    sendRecord: function(task, action) {
        var code = ReturnCode.SUCCESS;
    }
});

function getClass() { return EsdOglConnectSMAdapter; }
