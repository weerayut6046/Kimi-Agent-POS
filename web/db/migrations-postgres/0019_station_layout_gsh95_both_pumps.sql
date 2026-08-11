-- ปรับผังปั๊มของฐานข้อมูลที่ใช้งานอยู่ให้ตรงหน้างาน:
-- 2 ตู้จ่าย ตู้ละ 2 หัว จ่ายแก๊สโซฮอล์ 95 และดีเซล ทั้งสองตู้
--
-- ปั๊มนี้ไม่เคยขายแก๊สโซฮอล์ 91 เลย หัวจ่ายที่ฐานข้อมูลบันทึกว่าเป็น GSH91
-- จึงเป็นหัวจ่าย GSH95 ที่ถูกตั้งชนิดน้ำมันผิดมาตั้งแต่ต้น ไม่ใช่สินค้าที่เคยขายจริง
-- migration นี้จึงย้ายหัวจ่ายเป็น GSH95 ในที่เดิม (ไม่สร้างหัวใหม่ ไม่ปลดระวางหัวเดิม)
--
-- shift_readings ไม่ได้เก็บ product_id ของตัวเอง แต่อ้างชนิดน้ำมันผ่าน
-- nozzles.product_id การย้ายหัวจ่ายในที่เดิมจึงทำให้ประวัติกะที่เคยถูกนับเป็น
-- GSH91 กลับไปรายงานเป็น GSH95 และยอดลิตรไปกระทบยอดถัง GSH95 ตามที่เกิดขึ้นจริง
--
-- สิ่งที่ไม่แตะต้อง: shift_readings.price_per_liter เป็น snapshot ราคาที่ใช้ปิดกะ
-- และกระทบกับเงินสดที่นับจริงไปแล้ว การเขียนทับจะทำให้ยอดกะที่ปิดแล้วไม่ตรงกับ
-- เงินที่รับมาจริง จึงเก็บไว้ตามที่บันทึกไว้เดิม
--
-- ถังและสินค้า GSH91 จะลบก็ต่อเมื่อไม่เหลือประวัติอ้างอิงแล้วเท่านั้น:
--   • tank_refills / tank_readings เป็น ON DELETE CASCADE — ลบถังทิ้งจะพา
--     ประวัติรับเข้าและค่าวัดหายไปด้วย จึงต้องตรวจก่อนเสมอ
--   • sale_items / price_changes / stock_count_items เป็น ON DELETE SET NULL —
--     ลบสินค้าทิ้งจะทำให้บิลเก่าและประวัติราคาหลุดลิงก์สินค้า จึงเลือกปิดการใช้งาน
--     (active = false) แทนการลบ แล้วให้ผู้ดูแลตรวจสอบเอง
--
-- migration นี้รันซ้ำได้โดยไม่มีผลข้างเคียง และทำงานแยกตามสาขา
DO $$
DECLARE
  branch_row    record;
  gsh91_product integer;
  gsh95_product integer;
  gsh95_tank    integer;
  gsh91_tank    integer;
  moved_nozzles integer;
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

    UPDATE pos.nozzles
    SET product_id = gsh95_product,
        tank_id    = gsh95_tank,
        label      = replace(label, 'GSH91', 'GSH95')
    WHERE branch_id = branch_row.id
      AND product_id = gsh91_product;
    GET DIAGNOSTICS moved_nozzles = ROW_COUNT;

    IF moved_nozzles > 0 THEN
      RAISE NOTICE 'สาขา % — ย้ายหัวจ่าย % หัวจาก GSH91 ไปเป็น GSH95 พร้อมประวัติกะที่ผูกอยู่',
        branch_row.id, moved_nozzles;
    END IF;

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
        RAISE NOTICE 'สาขา % — เก็บถัง GSH91 id=% ไว้เพราะยังมีประวัติรับเข้า/ค่าวัด กรุณาตรวจสอบเอง',
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
      RAISE NOTICE 'สาขา % — ปิดการใช้งานสินค้า GSH91 (ยังมีประวัติอ้างอิงอยู่ กรุณาตรวจสอบเอง)',
        branch_row.id;
    ELSE
      DELETE FROM pos.products WHERE id = gsh91_product;
      RAISE NOTICE 'สาขา % — ลบสินค้า GSH91 ที่ไม่มีประวัติอ้างอิง', branch_row.id;
    END IF;
  END LOOP;
END $$;
