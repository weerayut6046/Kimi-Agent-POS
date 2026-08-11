-- ปรับผังปั๊มของฐานข้อมูลที่ใช้งานอยู่ให้ตรงหน้างาน:
-- 2 ตู้จ่าย ตู้ละ 2 หัว จ่ายแก๊สโซฮอล์ 95 และดีเซล ทั้งสองตู้
--
-- หลักการสำคัญ: ห้ามแก้ชนิดน้ำมันของหัวจ่ายที่มีประวัติกะแล้ว
-- เพราะ shift_readings ไม่ได้เก็บ product_id ของตัวเอง แต่อ้างชนิดน้ำมัน
-- ผ่าน nozzles.product_id การแก้ทับจะทำให้ยอดลิตรและกระทบยอดถังของกะเก่า
-- ย้ายไปอยู่ผิดชนิดน้ำมันย้อนหลัง (กฎเดียวกับที่ catalog.deleteNozzle บังคับไว้)
--
--   • หัวจ่าย GSH91 ที่ยังไม่มีประวัติกะ → เปลี่ยนเป็น GSH95 ได้ทันที
--   • หัวจ่าย GSH91 ที่มีประวัติกะแล้ว  → ปลดระวาง (active = false) แล้วเพิ่ม
--     หัวจ่าย GSH95 ใหม่บนตู้เดิม โดยยกเลขมิเตอร์/เลข P ปัจจุบันมาต่อ
--
-- ถังและสินค้า GSH91 จะลบก็ต่อเมื่อไม่เหลือประวัติอ้างอิงแล้วเท่านั้น:
--   • tank_refills / tank_readings เป็น ON DELETE CASCADE — ลบถังทิ้งจะพา
--     ประวัติรับเข้าและค่าวัดหายไปด้วย จึงต้องตรวจก่อนเสมอ
--   • sale_items / price_changes / stock_count_items เป็น ON DELETE SET NULL —
--     ลบสินค้าทิ้งจะทำให้บิลเก่าและประวัติราคาหลุดลิงก์สินค้า รายงานแยกตาม
--     สินค้าจะขาดข้อมูล จึงเลือกปิดการใช้งาน (active = false) แทนการลบ
--
-- migration นี้รันซ้ำได้โดยไม่มีผลข้างเคียง และทำงานแยกตามสาขา
DO $$
DECLARE
  branch_row    record;
  nozzle_row    record;
  gsh91_product integer;
  gsh95_product integer;
  gsh95_tank    integer;
  gsh91_tank    integer;
  keep_product  boolean;
BEGIN
  FOR branch_row IN SELECT id FROM pos.branches ORDER BY id LOOP
    SELECT id INTO gsh91_product
      FROM pos.products
      WHERE branch_id = branch_row.id AND code = 'GSH91'
      ORDER BY id
      LIMIT 1;
    CONTINUE WHEN gsh91_product IS NULL;

    SELECT id INTO gsh95_product
      FROM pos.products
      WHERE branch_id = branch_row.id AND code = 'GSH95'
      ORDER BY id
      LIMIT 1;

    SELECT id INTO gsh95_tank
      FROM pos.fuel_tanks
      WHERE branch_id = branch_row.id AND product_id = gsh95_product
      ORDER BY id
      LIMIT 1;

    IF gsh95_product IS NULL OR gsh95_tank IS NULL THEN
      RAISE NOTICE 'ข้ามสาขา % — ไม่พบสินค้าหรือถัง GSH95 ให้ย้ายหัวจ่ายไป', branch_row.id;
      CONTINUE;
    END IF;

    -- เฉพาะหัวจ่ายที่ยังใช้งานอยู่ — หัวที่ปลดระวางไปแล้วยังถือ product_id ของ GSH91
    -- อยู่ตามประวัติ ถ้าไม่กรองออก การรันซ้ำจะเพิ่มหัวจ่าย GSH95 ซ้ำทุกรอบ
    FOR nozzle_row IN
      SELECT * FROM pos.nozzles
      WHERE branch_id = branch_row.id
        AND product_id = gsh91_product
        AND active = true
      ORDER BY id
    LOOP
      IF EXISTS (SELECT 1 FROM pos.shift_readings WHERE nozzle_id = nozzle_row.id) THEN
        UPDATE pos.nozzles SET active = false WHERE id = nozzle_row.id;
        INSERT INTO pos.nozzles (
          branch_id, pump_id, product_id, tank_id, label,
          current_meter, current_money, active
        ) VALUES (
          branch_row.id,
          nozzle_row.pump_id,
          gsh95_product,
          gsh95_tank,
          replace(nozzle_row.label, 'GSH91', 'GSH95'),
          nozzle_row.current_meter,
          nozzle_row.current_money,
          true
        );
        RAISE NOTICE 'สาขา % — ปลดระวางหัวจ่าย "%" ที่มีประวัติกะ แล้วเพิ่มหัวจ่าย GSH95 บนตู้เดิม',
          branch_row.id, nozzle_row.label;
      ELSE
        UPDATE pos.nozzles
        SET product_id = gsh95_product,
            tank_id    = gsh95_tank,
            label      = replace(label, 'GSH91', 'GSH95')
        WHERE id = nozzle_row.id;
        RAISE NOTICE 'สาขา % — เปลี่ยนหัวจ่าย "%" เป็น GSH95 (ยังไม่มีประวัติกะ)',
          branch_row.id, nozzle_row.label;
      END IF;
    END LOOP;

    FOR gsh91_tank IN
      SELECT id FROM pos.fuel_tanks
      WHERE branch_id = branch_row.id AND product_id = gsh91_product
      ORDER BY id
    LOOP
      IF NOT EXISTS (SELECT 1 FROM pos.tank_refills WHERE tank_id = gsh91_tank)
        AND NOT EXISTS (SELECT 1 FROM pos.tank_readings WHERE tank_id = gsh91_tank)
        AND NOT EXISTS (SELECT 1 FROM pos.nozzles WHERE tank_id = gsh91_tank)
      THEN
        DELETE FROM pos.fuel_tanks WHERE id = gsh91_tank;
        RAISE NOTICE 'สาขา % — ลบถัง GSH91 id=% ที่ไม่มีประวัติ', branch_row.id, gsh91_tank;
      ELSE
        RAISE NOTICE 'สาขา % — เก็บถัง GSH91 id=% ไว้เพราะยังมีประวัติหรือหัวจ่ายอ้างอิงอยู่',
          branch_row.id, gsh91_tank;
      END IF;
    END LOOP;

    SELECT
      EXISTS (SELECT 1 FROM pos.nozzles WHERE product_id = gsh91_product)
      OR EXISTS (SELECT 1 FROM pos.fuel_tanks WHERE product_id = gsh91_product)
      OR EXISTS (SELECT 1 FROM pos.sale_items WHERE product_id = gsh91_product)
      OR EXISTS (SELECT 1 FROM pos.price_changes WHERE product_id = gsh91_product)
      OR EXISTS (SELECT 1 FROM pos.stock_count_items WHERE product_id = gsh91_product)
    INTO keep_product;

    IF keep_product THEN
      UPDATE pos.products SET active = false WHERE id = gsh91_product;
      RAISE NOTICE 'สาขา % — ปิดการใช้งานสินค้า GSH91 (ยังมีประวัติอ้างอิงอยู่)', branch_row.id;
    ELSE
      DELETE FROM pos.products WHERE id = gsh91_product;
      RAISE NOTICE 'สาขา % — ลบสินค้า GSH91 ที่ไม่มีประวัติอ้างอิง', branch_row.id;
    END IF;
  END LOOP;
END $$;
