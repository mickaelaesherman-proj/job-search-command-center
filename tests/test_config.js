// Fictional settings used by the tests in place of the private Config.gs.
var PRIVATE_CONFIG = {
  // Fictional test settings (the real ones live in the private Config.gs, never on GitHub).
  genericCompanyNames: ['forward', 'harbor', 'spark', 'steady'],
  emailAliases: {
    'PayPath by Summit': ['summit'], 'Hirewel': ['hirewell'], 'Merdian': ['meridian'], 'Vex Global': ['vex'],
    'QTech System': ['qtech'], 'WolfWorks': ['wolf works'], 'DeskMate': ['desk mate']
  }
};
if (typeof module !== 'undefined') module.exports = { TEST_CONFIG_SOURCE: "var PRIVATE_CONFIG = {\n  // Fictional test settings (the real ones live in the private Config.gs, never on GitHub).\n  genericCompanyNames: ['forward', 'harbor', 'spark', 'steady'],\n  emailAliases: {\n    'PayPath by Summit': ['summit'], 'Hirewel': ['hirewell'], 'Merdian': ['meridian'], 'Vex Global': ['vex'],\n    'QTech System': ['qtech'], 'WolfWorks': ['wolf works'], 'DeskMate': ['desk mate']\n  }\n};" };
