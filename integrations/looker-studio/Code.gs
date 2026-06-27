/**
 * OmniPresence Engine — Looker Studio Community Connector
 *
 * Reads the API-key-authenticated `/api/v1/export` endpoint. Configure in the
 * connector setup: Base URL, API key (omp_...), Project ID, and dataset type.
 *
 * Deploy: clasp push this folder as an Apps Script project, then "Deploy >
 * Test deployments" and use the connector in Looker Studio.
 */

var cc = DataStudioApp.createCommunityConnector();

function getAuthType() {
  return cc.newAuthTypeResponse().setAuthType(cc.AuthType.NONE).build();
}

function isAdminUser() {
  return false;
}

function getConfig() {
  var config = cc.getConfig();
  config
    .newTextInput()
    .setId('baseUrl')
    .setName('Base URL')
    .setHelpText('e.g. https://app.omnipresence.engine')
    .setPlaceholder('https://app.omnipresence.engine');
  config
    .newTextInput()
    .setId('apiKey')
    .setName('API Key')
    .setHelpText('Your OmniPresence API key (omp_...)');
  config
    .newTextInput()
    .setId('projectId')
    .setName('Project ID')
    .setHelpText('The project UUID to export.');
  config
    .newSelectSingle()
    .setId('dataset')
    .setName('Dataset')
    .addOption(cc.newOptionBuilder().setLabel('Ranks').setValue('ranks'))
    .addOption(cc.newOptionBuilder().setLabel('Keywords').setValue('keywords'))
    .addOption(cc.newOptionBuilder().setLabel('AI Visibility').setValue('visibility'))
    .addOption(cc.newOptionBuilder().setLabel('Technical Findings').setValue('findings'))
    .addOption(cc.newOptionBuilder().setLabel('Mentions').setValue('mentions'))
    .addOption(cc.newOptionBuilder().setLabel('Tasks').setValue('tasks'))
    .addOption(cc.newOptionBuilder().setLabel('Content Gaps').setValue('content_gaps'))
    .addOption(cc.newOptionBuilder().setLabel('Local Grid').setValue('local'));
  return config.build();
}

function fetchRows(request) {
  var p = request.configParams || {};
  var url =
    p.baseUrl.replace(/\/+$/, '') +
    '/api/v1/export?projectId=' +
    encodeURIComponent(p.projectId) +
    '&type=' +
    encodeURIComponent(p.dataset || 'ranks') +
    '&format=json';
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'x-api-key': p.apiKey },
    muteHttpExceptions: true,
  });
  var body = JSON.parse(res.getContentText());
  return body.rows || [];
}

function getFields(rows) {
  var fields = cc.getFields();
  var types = cc.FieldType;
  var sample = rows && rows.length ? rows[0] : {};
  Object.keys(sample).forEach(function (key) {
    var val = sample[key];
    var f = fields.newDimension();
    if (typeof val === 'number') f = fields.newMetric().setType(types.NUMBER);
    else if (typeof val === 'boolean') f.setType(types.BOOLEAN);
    else f.setType(types.TEXT);
    f.setId(key).setName(key);
  });
  return fields;
}

function getSchema(request) {
  var rows = fetchRows(request);
  return { schema: getFields(rows).build() };
}

function getData(request) {
  var rows = fetchRows(request);
  var requestedFieldIds = request.fields.map(function (f) {
    return f.name;
  });
  var fields = getFields(rows).forIds(requestedFieldIds);

  var data = rows.map(function (row) {
    return {
      values: requestedFieldIds.map(function (id) {
        var v = row[id];
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return v;
      }),
    };
  });

  return {
    schema: fields.build(),
    rows: data,
  };
}
