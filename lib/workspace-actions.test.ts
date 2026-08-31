import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';

import { createSeedState } from './model';
import {
  auditCsvContent,
  gaugesCsvContent,
  parseGaugeCsv,
  sanitizeSpreadsheetCell,
} from './workspace-actions';

describe('spreadsheet safety', () => {
  it('neutralizes formula-like values on export', () => {
    expect(sanitizeSpreadsheetCell('=HYPERLINK("bad")')).toBe(
      '\'=HYPERLINK("bad")',
    );
    expect(sanitizeSpreadsheetCell('+123')).toBe("'+123");
    expect(sanitizeSpreadsheetCell(' \t=HYPERLINK("x")')).toBe(
      '\' \t=HYPERLINK("x")',
    );
    expect(sanitizeSpreadsheetCell('Micrometer')).toBe('Micrometer');
  });

  it('sanitizes every gauge and audit CSV field', () => {
    const state = createSeedState();
    state.gauges[0].assetId = '\t=CMD()';
    state.gauges[0].lifecycle = '=formula' as never;
    const gaugeRows = Papa.parse<Record<string, string>>(
      gaugesCsvContent(state.gauges),
      { header: true },
    ).data;
    expect(gaugeRows[0].asset_id).toBe("'\t=CMD()");
    expect(gaugeRows[0].lifecycle_status).toBe("'=formula");

    state.audit[0].action = ' +SUM(A1:A2)';
    state.audit[0].entityType = '@formula' as never;
    state.audit[0].entityId = '-1+1';
    const auditRows = Papa.parse<Record<string, string>>(
      auditCsvContent(state.audit),
      { header: true },
    ).data;
    expect(auditRows[0].action).toBe("' +SUM(A1:A2)");
    expect(auditRows[0].entity_type).toBe("'@formula");
    expect(auditRows[0].entity_id).toBe("'-1+1");
  });
});

describe('CSV dry run', () => {
  it('normalizes a valid row without writing state', () => {
    const source =
      'asset_id,name,type,calibration_interval_months,next_due\nNEW-001,New micrometer,measuring-equipment,12,2027-01-15';
    const state = createSeedState();
    const preview = parseGaugeCsv(source, state.gauges);
    expect(preview.errors).toEqual([]);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].assetId).toBe('NEW-001');
    expect(state.gauges.some((gauge) => gauge.assetId === 'NEW-001')).toBe(
      false,
    );
  });

  it('reports duplicate IDs and invalid intervals before commit', () => {
    const source =
      'asset_id,name,calibration_interval_months\nDIM-042,Duplicate,12\nNEW-002,Bad interval,0';
    const preview = parseGaugeCsv(source, createSeedState().gauges);
    expect(preview.errors.join(' ')).toContain('already exists');
    expect(preview.errors.join(' ')).toContain('must be 1–120');
    expect(preview.rows).toHaveLength(0);
  });
});
