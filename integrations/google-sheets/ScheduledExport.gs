/**
 * OmniPresence Engine — Scheduled Google Sheets export.
 *
 * Pulls a dataset from `/api/v1/export` into a sheet tab on a schedule.
 * Setup:
 *   1. Extensions > Apps Script, paste this file.
 *   2. Set Script Properties: BASE_URL, API_KEY, PROJECT_ID.
 *   3. Run `setup()` once to create a daily time-driven trigger.
 *
 * Datasets: ranks, keywords, visibility, findings, mentions, tasks,
 *           content_gaps, local, backlinks, coverage, snippets, ledger.
 */

var DATASETS = ['ranks', 'keywords', 'visibility', 'findings', 'mentions', 'tasks'];

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runExport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runExport').timeBased().everyDays(1).atHour(6).create();
  runExport();
}

function runExport() {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = (props.getProperty('BASE_URL') || '').replace(/\/+$/, '');
  var apiKey = props.getProperty('API_KEY');
  var projectId = props.getProperty('PROJECT_ID');
  if (!baseUrl || !apiKey || !projectId) {
    throw new Error('Set BASE_URL, API_KEY, PROJECT_ID in Script Properties.');
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  DATASETS.forEach(function (dataset) {
    var url =
      baseUrl +
      '/api/v1/export?projectId=' +
      encodeURIComponent(projectId) +
      '&type=' +
      dataset +
      '&format=json';
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'x-api-key': apiKey },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) return;
    var body = JSON.parse(res.getContentText());
    var rows = body.rows || [];
    var schema = body.schema || (rows.length ? Object.keys(rows[0]) : []);
    if (!schema.length) return;

    var sheet = ss.getSheetByName(dataset) || ss.insertSheet(dataset);
    sheet.clearContents();
    sheet.getRange(1, 1, 1, schema.length).setValues([schema]);
    if (rows.length) {
      var values = rows.map(function (r) {
        return schema.map(function (c) {
          var v = r[c];
          if (v === null || v === undefined) return '';
          if (typeof v === 'object') return JSON.stringify(v);
          return v;
        });
      });
      sheet.getRange(2, 1, values.length, schema.length).setValues(values);
    }
  });
}
