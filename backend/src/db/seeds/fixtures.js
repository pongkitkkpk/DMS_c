/**
 * Development fixtures (Q17): one person per role with a realistic club and
 * year, and one project resting in each of the seven phases so every screen and
 * every transition has something to act on.
 *
 * Clubs are looked up rather than hardcoded — setCode.json is the source of
 * truth for which clubs exist, and a fixture that invents one would drift.
 */
const { buildClubCode, buildProjectNumber } = require('../../lib/clubCode');

const ACADEMIC_YEAR = 2567;

async function one(conn, sql, params) {
  const [rows] = await conn.query(sql, params);
  if (!rows.length) throw new Error(`fixture lookup returned nothing: ${sql}`);
  return rows[0];
}

async function insert(conn, table, row) {
  const cols = Object.keys(row);
  const [r] = await conn.query(
    `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    cols.map((c) => row[c])
  );
  return r.insertId;
}

async function seedFixtures(conn, log) {
  // --- pick a real club: a cultural club on the Bangkok campus ---
  const club = await one(conn, `
    SELECT c.id, c.code, c.name_th, c.work_group_code,
           d.code AS division_code, cam.abbreviation, cam.id AS campus_id, cg.id AS club_group_id
      FROM club c
      JOIN division d    ON d.id = c.division_id
      JOIN campus cam    ON cam.id = c.campus_id
      JOIN club_group cg ON cg.id = c.club_group_id
     WHERE cg.code = 'CULTURE' AND cam.code = 'Bangkok'
     ORDER BY c.code LIMIT 1`);

  const clubCode = buildClubCode({
    campusAbbreviation: club.abbreviation,
    academicYear: ACADEMIC_YEAR,
    divisionCode: club.division_code,
    clubCode: club.code,
    workGroupCode: club.work_group_code,
  });

  const stuactAgency = await one(conn, `
    SELECT a.id FROM agency a JOIN division d ON d.id = a.division_id
     WHERE d.code = 'D01' AND a.code = 'A001' LIMIT 1`);

  // --- people, one per role ---
  const people = {
    sh:     { id_student: 'fixture.student', full_name_th: 'สมชาย นักศึกษา',  account_type: 'students', email: 'student@example.test' },
    ad:     { id_student: 'fixture.advisor', full_name_th: 'สมหญิง ที่ปรึกษา', account_type: 'personel', email: 'advisor@example.test' },
    stuact: { id_student: 'fixture.stuact',  full_name_th: 'สมศักดิ์ กิจการ',  account_type: 'personel', email: 'stuact@example.test' },
    admin:  { id_student: 'fixture.admin',   full_name_th: 'ผู้ดูแล ระบบ',     account_type: 'personel', email: 'admin@example.test' },
  };
  for (const key of Object.keys(people)) {
    people[key].id = await insert(conn, 'person', people[key]);
  }

  // The CHECK on membership enforces the split: SH/AD carry a club and no
  // jurisdiction, STUACT carries a jurisdiction and no club, ADMIN carries
  // neither. See docs/domain-model.md, "The two scope columns are opposites".
  await insert(conn, 'membership', {
    person_id: people.sh.id, role: 'SH', academic_year: ACADEMIC_YEAR,
    club_id: club.id, department_th: 'วิทยาลัยเทคโนโลยีอุตสาหกรรม',
  });
  await insert(conn, 'membership', {
    person_id: people.ad.id, role: 'AD', academic_year: ACADEMIC_YEAR,
    club_id: club.id, advisor_agency: 'กองกิจการนักศึกษา',
  });
  await insert(conn, 'membership', {
    person_id: people.stuact.id, role: 'STUACT', academic_year: ACADEMIC_YEAR,
    agency_id: stuactAgency.id, jurisdiction_club_group_id: club.club_group_id,
  });
  await insert(conn, 'membership', {
    person_id: people.admin.id, role: 'ADMIN', academic_year: ACADEMIC_YEAR,
  });

  // --- one project resting in each phase ---
  const [phases] = await conn.query('SELECT `id`,`code`,`ordinal`,`name_th` FROM `phase` ORDER BY `ordinal`');

  let approvedSequence = 0;
  const projectIds = [];

  for (const phase of phases) {
    const draftSequence = phase.ordinal;
    // project_sequence and project_number are issued on entry to PROJECT_APPROVED
    // (ordinal 3) and never before — that is the real behaviour of the old system.
    const numbered = phase.ordinal >= 3;
    if (numbered) approvedSequence += 1;

    const projectId = await insert(conn, 'project', {
      club_id: club.id,
      owner_person_id: people.sh.id,
      advisor_person_id: people.ad.id,
      academic_year: ACADEMIC_YEAR,
      name: `โครงการตัวอย่าง — ${phase.name_th}`,
      draft_sequence: draftSequence,
      project_sequence: numbered ? approvedSequence : null,
      project_number: numbered ? buildProjectNumber(clubCode, approvedSequence) : null,
      phase_id: phase.id,
      is_new_project: 1,
      prepare_start_on: '2024-06-01',
      prepare_end_on: '2024-06-15',
      event_start_on: '2024-07-01',
      event_end_on: '2024-07-03',
      contact1_name: people.sh.full_name_th,
      contact1_phone: '0800000000',
    });
    projectIds.push(projectId);

    await insert(conn, 'project_event', {
      project_id: projectId, event_type: 'CREATED',
      to_phase_id: phases[0].id, actor_person_id: people.sh.id,
    });

    await insert(conn, 'project_objective', { project_id: projectId, ordinal: 1, content: 'เพื่อส่งเสริมกิจกรรมนักศึกษา' });
    await insert(conn, 'project_rationale', { project_id: projectId, ordinal: 1, content: 'กิจกรรมนักศึกษาเป็นส่วนสำคัญของการพัฒนาบัณฑิต' });
    await insert(conn, 'project_location',  { project_id: projectId, ordinal: 1, content: 'หอประชุม มจพ. กรุงเทพฯ' });
    await insert(conn, 'project_activity',  { project_id: projectId, ordinal: 1, topic: 'เตรียมงาน', start_on: '2024-06-01', end_on: '2024-06-15' });
    await insert(conn, 'project_activity',  { project_id: projectId, ordinal: 2, topic: 'จัดกิจกรรม', start_on: '2024-07-01', end_on: '2024-07-03' });
    await insert(conn, 'project_indicator', { project_id: projectId, ordinal: 1, expected_result: 'นักศึกษาเข้าร่วมไม่น้อยกว่าร้อยละ 80', volume_target: '100 คน' });
    await insert(conn, 'project_attendance', { project_id: projectId, variant: 'PLANNED', attendee_type: 'STUDENT', ordinal: 1, label: 'นักศึกษาผู้เข้าร่วม', headcount: 100 });
    await insert(conn, 'project_attendance', { project_id: projectId, variant: 'PLANNED', attendee_type: 'PROFESSOR', ordinal: 1, label: 'อาจารย์', headcount: 5 });

    // Budget: A is people x hours x rate; C is qty x price. `amount` is computed
    // by the database, so nothing here states a total.
    await insert(conn, 'budget_line', {
      project_id: projectId, variant: 'PLANNED', category: 'A', ordinal: 1,
      description: 'ค่าตอบแทนวิทยากร', qty1: 2, qty2: 6, unit_price: 600,
    });
    await insert(conn, 'budget_line', {
      project_id: projectId, variant: 'PLANNED', category: 'C', ordinal: 1,
      description: 'ค่าวัสดุอุปกรณ์', qty1: 100, unit1: 'ชุด', unit_price: 120,
    });

    const planned = 7200 + 12000;
    await insert(conn, 'budget_plan_line', {
      project_id: projectId,
      planned_amount: planned,
      approved_amount: numbered ? planned : null,
      approved_by: numbered ? people.stuact.id : null,
      approved_at: numbered ? new Date() : null,
    });

    // Phases past disbursement have money out and actuals recorded.
    if (phase.ordinal >= 4) {
      await insert(conn, 'disbursement', {
        project_id: projectId, amount: 15000,
        received_by_name: people.sh.full_name_th, issued_by_name: people.stuact.full_name_th,
      });
      await insert(conn, 'budget_line', {
        project_id: projectId, variant: 'ACTUAL', category: 'A', ordinal: 1,
        description: 'ค่าตอบแทนวิทยากร', qty1: 2, qty2: 6, unit_price: 600,
      });
      await insert(conn, 'budget_line', {
        project_id: projectId, variant: 'ACTUAL', category: 'C', ordinal: 1,
        description: 'ค่าวัสดุอุปกรณ์', qty1: 80, unit1: 'ชุด', unit_price: 120,
      });
      await insert(conn, 'project_attendance', {
        project_id: projectId, variant: 'ACTUAL', attendee_type: 'STUDENT', ordinal: 1,
        label: 'นักศึกษาผู้เข้าร่วม', headcount: 92,
      });
    }
  }

  // An allocation generous enough that the fixtures sit inside it — the point is
  // to have a ceiling present, not to trip it.
  await insert(conn, 'agency_allocation', {
    club_id: club.id, campus_id: club.campus_id, academic_year: ACADEMIC_YEAR,
    amount: 500000, created_by: people.admin.id,
  });

  // A couple of tags so project_tag is exercised.
  const [sdgTags] = await conn.query(`
    SELECT t.id FROM tag t JOIN tag_set s ON s.id = t.tag_set_id
     WHERE s.code = 'SDG' AND t.ordinal IN (4, 17)`);
  for (const projectId of projectIds) {
    for (const t of sdgTags) {
      await insert(conn, 'project_tag', { project_id: projectId, tag_id: t.id });
    }
  }

  log(`  club          ${club.name_th} (${club.code})  club_code ${clubCode}`);
  log(`  person 4 · membership 4 · project ${projectIds.length} (one per phase)`);
  log(`  numbered projects: ${approvedSequence} (phases 3-7), first ${buildProjectNumber(clubCode, 1)}`);
  log(`  logins: ${Object.values(people).map((p) => p.id_student).join(', ')}`);
}

module.exports = { seedFixtures, ACADEMIC_YEAR };
