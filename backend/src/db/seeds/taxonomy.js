/**
 * Organisation seed — campus, division, agency, work_group, club_group, club,
 * award_category — from setCode.json (Q34).
 *
 * setCode.json's `Agency` level has FOUR different shapes (docs/domain-model.md):
 *
 *   D01-D03  Agency is a LIST of named groups, split by code range:
 *              A0xx = organisational unit  -> `agency`
 *              A1xx = the student body of that same unit -> `club` (no club group)
 *   D04      Agency is a LIST of the five club groups, each nested by campus
 *              -> `club_group` + `club`
 *   D05      Agency is a plain DICT -> `agency`
 *   D06-D12  Agency is a DICT with a single A001; these name STUDENTS
 *              -> `award_category` (Q35), NOT org units
 *
 * Known data problems are corrected here and every correction is logged (Q36).
 */
const path = require('path');
const fs = require('fs');

const SET_CODE = path.join(__dirname, 'setCode.json');

const CAMPUSES = [
  { code: 'Bangkok', abbreviation: 'B', name_th: 'มจพ. กรุงเทพฯ' },
  { code: 'Prachin', abbreviation: 'P', name_th: 'มจพ. ปราจีนบุรี' },
  { code: 'Rayong',  abbreviation: 'R', name_th: 'มจพ. ระยอง' },
];

// The five D04 groups. Matched to setCode.json by their Thai name, which is also
// the value the old schema stored in projects.AgnecyGroupName.
const CLUB_GROUP_CODES = {
  'องค์กรนักศึกษาส่วนกลาง': 'CENTRAL',
  'ชมรมฝ่ายวิชาการ': 'ACADEMIC',
  'ชมรมฝ่ายศิลปวัฒนธรรม': 'CULTURE',
  'ชมรมฝ่ายอาสาพัฒนาและบำเพ็ญประโยชน์': 'VOLUNTEER',
  'ชมรมฝ่ายกีฬา': 'SPORT',
};

// Q36: fix taxonomy typos during seed and log them. Exact-match only — a
// correction that stops matching should surface as "not applied", never be
// silently skipped.
const TEXT_CORRECTIONS = [
  ['วิศวกรรมเตมี', 'วิศวกรรมเคมี'],
  ['เทคโนโลยรสารสนเทศ', 'เทคโนโลยีสารสนเทศ'],
  ['ปราจียนบุรี', 'ปราจีนบุรี'],
  ['ฝรั่งเศษ', 'ฝรั่งเศส'],
];

// D02's student unions A103..A115 carry their parent faculty's name verbatim,
// so a dropdown would show e.g. 'คณะวิทยาศาสตร์ประยุกต์' twice — once as the
// faculty, once as its student union. A101/A102 are correctly prefixed, which
// is what shows this is an omission rather than a naming convention.
const PREFIX_STUDENT_UNION = 'สโมสร';

function isAgencyCode(k) { return /^A\d+$/.test(k); }
function nameOf(v) { return typeof v === 'string' ? v : v && v.name; }

/**
 * Read setCode.json and flatten it into rows, collecting a correction log.
 * Pure — does no database work — so it can be tested and diffed on its own.
 */
function buildTaxonomy() {
  const raw = JSON.parse(fs.readFileSync(SET_CODE, 'utf8'));
  const divisions = [];
  const agencies = [];      // {division_code, campus_code|null, code, name_th, work_groups:[]}
  const clubGroups = [];
  const clubs = [];         // {division_code, campus_code, code, name_th, club_group_name|null, parent_agency_code|null}
  const awards = [];
  const corrections = [];
  const warnings = [];

  const fix = (text, where) => {
    if (typeof text !== 'string') return text;
    let out = text;
    for (const [from, to] of TEXT_CORRECTIONS) {
      if (out.includes(from)) {
        out = out.split(from).join(to);
        corrections.push({ where, from, to, kind: 'typo' });
      }
    }
    return out;
  };

  for (const [dCode, dVal] of Object.entries(raw.Divison)) {
    const dName = fix(dVal.name, `${dCode}.name`);

    // D06-D12 are student award categories, not org units (Q35).
    if (dCode >= 'D06') {
      awards.push({ code: dCode, name_th: dName });
      continue;
    }

    divisions.push({ code: dCode, name_th: dName });
    const agencyLevel = dVal.Agency;

    // D05 shape: a plain dict of agencies.
    if (!Array.isArray(agencyLevel)) {
      for (const [aCode, aVal] of Object.entries(agencyLevel || {})) {
        agencies.push({
          division_code: dCode, campus_code: null, code: aCode,
          name_th: fix(nameOf(aVal), `${dCode}.${aCode}`), work_groups: [],
        });
      }
      continue;
    }

    for (const group of agencyLevel) {
      const groupName = group.name;
      const campusKeys = Object.keys(group).filter((k) => k !== 'name' && !isAgencyCode(k));
      const agencyCodes = Object.keys(group).filter(isAgencyCode);

      // D04 shape: campus nesting, and the group name is a club group.
      if (campusKeys.length) {
        const groupCode = CLUB_GROUP_CODES[groupName];
        if (!groupCode) {
          warnings.push(`Unmapped D04 group name: ${JSON.stringify(groupName)} — skipped`);
          continue;
        }
        if (!clubGroups.some((g) => g.code === groupCode)) {
          clubGroups.push({ code: groupCode, name_th: groupName });
        }
        for (const campusCode of campusKeys) {
          const entries = Object.entries(group[campusCode] || {});
          if (!entries.length) {
            warnings.push(`${groupName} / ${campusCode}: no clubs in setCode.json`);
          }
          for (const [cCode, cVal] of entries) {
            clubs.push({
              division_code: dCode, campus_code: campusCode, code: cCode,
              name_th: fix(nameOf(cVal), `${dCode}.${campusCode}.${cCode}`),
              club_group_name: groupName, parent_agency_code: null,
            });
          }
        }
        continue;
      }

      // D01-D03 shape: A0xx = org unit, A1xx = its student body.
      for (const aCode of agencyCodes) {
        const aVal = group[aCode];
        let name = fix(nameOf(aVal), `${dCode}.${aCode}`);

        if (aCode.startsWith('A0')) {
          const wgRaw = (typeof aVal === 'object' && aVal.WorkGroup) || {};
          const work_groups = Object.entries(wgRaw)
            .map(([wCode, wName]) => ({ code: wCode, name_th: fix(wName, `${dCode}.${aCode}.${wCode}`) }))
            // 'ภาควิชา(ในเอกสารซ้ำ)' is a placeholder in the source, not a department.
            .filter(({ code, name_th }) => {
              if (/\(ในเอกสารซ้ำ\)/.test(name_th)) {
                corrections.push({ where: `${dCode}.${aCode}.${code}`, from: name_th, to: null, kind: 'placeholder-dropped' });
                return false;
              }
              return true;
            });
          agencies.push({ division_code: dCode, campus_code: null, code: aCode, name_th: name, work_groups });
        } else {
          // A1xx mirrors A0xx by position: A103 <-> A003.
          const parentCode = 'A0' + aCode.slice(2);
          const parent = agencies.find((a) => a.division_code === dCode && a.code === parentCode);
          if (parent && parent.name_th === name) {
            const fixed = PREFIX_STUDENT_UNION + name;
            corrections.push({ where: `${dCode}.${aCode}`, from: name, to: fixed, kind: 'student-union-name' });
            name = fixed;
          }
          // These 16 bodies belong to no club group — only D04 clubs do.
          clubs.push({
            division_code: dCode, campus_code: 'Bangkok', code: aCode, name_th: name,
            club_group_name: null, parent_agency_code: parent ? parentCode : null,
          });
          if (!parent) {
            warnings.push(`${dCode}.${aCode} has no matching ${parentCode} — parent_agency_id left NULL`);
          }
        }
      }
    }
  }

  // Every correction must have fired; one that did not means setCode.json changed.
  for (const [from] of TEXT_CORRECTIONS) {
    if (!corrections.some((c) => c.from.includes(from) || from.includes(c.from))) {
      warnings.push(`Correction ${JSON.stringify(from)} never matched — verify it is still needed`);
    }
  }

  return { divisions, agencies, clubGroups, clubs, awards, corrections, warnings };
}

async function seedTaxonomy(conn, log) {
  const t = buildTaxonomy();

  const campusId = {};
  for (const c of CAMPUSES) {
    const [r] = await conn.query(
      'INSERT INTO `campus` (`code`,`abbreviation`,`name_th`) VALUES (?,?,?)',
      [c.code, c.abbreviation, c.name_th]
    );
    campusId[c.code] = r.insertId;
  }

  const divisionId = {};
  for (const d of t.divisions) {
    const [r] = await conn.query('INSERT INTO `division` (`code`,`name_th`) VALUES (?,?)', [d.code, d.name_th]);
    divisionId[d.code] = r.insertId;
  }

  const agencyId = {};
  for (const a of t.agencies) {
    const [r] = await conn.query(
      'INSERT INTO `agency` (`division_id`,`campus_id`,`code`,`name_th`) VALUES (?,?,?,?)',
      [divisionId[a.division_code], a.campus_code ? campusId[a.campus_code] : null, a.code, a.name_th]
    );
    agencyId[`${a.division_code}.${a.code}`] = r.insertId;
    for (const w of a.work_groups) {
      await conn.query(
        'INSERT INTO `work_group` (`agency_id`,`code`,`name_th`) VALUES (?,?,?)',
        [r.insertId, w.code, w.name_th]
      );
    }
  }

  const clubGroupId = {};
  for (const g of t.clubGroups) {
    const [r] = await conn.query('INSERT INTO `club_group` (`code`,`name_th`) VALUES (?,?)', [g.code, g.name_th]);
    clubGroupId[g.name_th] = r.insertId;
  }

  for (const c of t.clubs) {
    await conn.query(
      'INSERT INTO `club` (`club_group_id`,`campus_id`,`division_id`,`code`,`work_group_code`,`name_th`,`parent_agency_id`) VALUES (?,?,?,?,?,?,?)',
      [
        c.club_group_name ? clubGroupId[c.club_group_name] : null,
        campusId[c.campus_code],
        divisionId[c.division_code],
        c.code,
        '00',
        c.name_th,
        c.parent_agency_code ? agencyId[`${c.division_code}.${c.parent_agency_code}`] : null,
      ]
    );
  }

  for (const a of t.awards) {
    await conn.query('INSERT INTO `award_category` (`code`,`name_th`) VALUES (?,?)', [a.code, a.name_th]);
  }

  const wgCount = t.agencies.reduce((n, a) => n + a.work_groups.length, 0);
  log(`  campus ${CAMPUSES.length} · division ${t.divisions.length} · agency ${t.agencies.length} · work_group ${wgCount}`);
  log(`  club_group ${t.clubGroups.length} · club ${t.clubs.length} · award_category ${t.awards.length}`);

  if (t.corrections.length) {
    log(`  corrections applied (${t.corrections.length}):`);
    for (const c of t.corrections) {
      log(`    [${c.kind}] ${c.where}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
    }
  }
  if (t.warnings.length) {
    log(`  warnings (${t.warnings.length}):`);
    for (const w of t.warnings) log(`    ! ${w}`);
  }
}

module.exports = { seedTaxonomy, buildTaxonomy, CAMPUSES, CLUB_GROUP_CODES };
