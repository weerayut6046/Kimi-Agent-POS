import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  assistantActionProposals,
  expenses,
  members,
  products,
  saleItems,
  sales,
  staffUsers,
} from "@db/schema";
import { setupTestDb, type TestDb } from "../test/testDb";

let t: TestDb;
let redactSensitiveText: (text: string) => string;

function completion(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function toolCompletion(name: string, id: string, argumentsJson = "{}") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id,
                type: "function",
                function: { name, arguments: argumentsJson },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

beforeAll(async () => {
  process.env.DEEPSEEK_API_KEY = "test-deepseek-server-key";
  t = await setupTestDb();
  ({ redactSensitiveText } = await import("./assistant"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => t.cleanup());

describe("AI assistant security", () => {
  it("redacts common credentials and direct identifiers before external processing", () => {
    const redacted = redactSensitiveText(
      "PIN: 1234 โทร 0812345678 email buyer@example.com เลข 1234567890123 postgresql://user:pass@db.local/app"
    );
    expect(redacted).not.toContain("1234");
    expect(redacted).not.toContain("0812345678");
    expect(redacted).not.toContain("buyer@example.com");
    expect(redacted).not.toContain("1234567890123");
    expect(redacted).not.toContain("user:pass");
  });

  it("sends redacted chat and no staff/customer identity to DeepSeek", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completion("รับทราบครับ"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.caller("cashier").assistant.chat({
      messages: [
        {
          role: "user",
          content: "ช่วยดูให้หน่อย PIN: 1234 เบอร์ลูกค้า 0812345678",
        },
      ],
    });

    expect(result.answer).toBe("รับทราบครับ");
    expect(result.includeInModelContext).toBe(true);
    const body = String(fetchMock.mock.calls[0][1]?.body);
    expect(body).not.toContain("0812345678");
    expect(body).not.toContain("PIN: 1234");
    expect(body).not.toContain("สมชาย");
    expect(body).not.toContain("test-deepseek-server-key");
  });

  it("keeps operational query results inside PumpPOS instead of returning them to DeepSeek", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(toolCompletion("get_low_stock", "call-stock"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.caller("cashier").assistant.chat({
      messages: [{ role: "user", content: "มีสต๊อกอะไรต่ำบ้าง" }],
    });

    expect(result.answer).toContain("รายการที่ต่ำกว่าเกณฑ์");
    expect(result.answer).toContain("ไม่ได้ส่งให้ DeepSeek");
    expect(fetchMock).toHaveBeenCalledOnce();
    const externalRequest = String(fetchMock.mock.calls[0][1]?.body);
    expect(externalRequest).not.toContain("ถังดีเซล B7");
    expect(externalRequest).not.toContain("3100");
    expect(externalRequest).not.toContain("get_all_fuel_tank_levels");
    expect(externalRequest).not.toContain("get_admin_business_summary");
    expect(externalRequest).not.toContain("get_admin_documents");
  });

  it("calculates today's fuel sales volume and keeps the figures inside PumpPOS", async () => {
    const [fuel] = await t.db
      .insert(products)
      .values({
        branchId: 1,
        code: "AI-FUEL-TEST",
        name: "น้ำมันทดสอบ AI",
        category: "fuel",
        unit: "ลิตร",
        price: 40,
        cost: 30,
        stockQty: 1_000,
        lowStockAt: 100,
      })
      .returning();
    const [sale] = await t.db
      .insert(sales)
      .values({
        branchId: 1,
        receiptNo: "AI-FUEL-VOLUME-001",
        staffName: "ผู้ทดสอบ",
        subtotal: 250,
        total: 250,
        paymentMethod: "cash",
        received: 250,
      })
      .returning();
    await t.db.insert(saleItems).values({
      branchId: 1,
      saleId: sale.id,
      productId: fuel.id,
      name: fuel.name,
      qty: 6.25,
      unit: "ลิตร",
      unitPrice: 40,
      amount: 250,
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        toolCompletion("get_today_sales_overview", "call-fuel-volume")
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.caller("cashier").assistant.chat({
      messages: [
        { role: "user", content: "คำนวณปริมาตรการขายน้ำมันวันนี้ได้ไหม" },
      ],
    });

    expect(result.answer).toContain("ปริมาณน้ำมันที่ขายได้วันนี้");
    expect(result.answer).toContain("AI-FUEL-TEST น้ำมันทดสอบ AI: 6.25 ลิตร");
    expect(result.includeInModelContext).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.tool_choice).toEqual({
      type: "function",
      function: { name: "get_today_sales_overview" },
    });
    const externalRequest = JSON.stringify(requestBody);
    expect(externalRequest).not.toContain("น้ำมันทดสอบ AI");
    expect(externalRequest).not.toContain("6.25");
  });

  it("allows only admin to read every fuel tank level while keeping values out of DeepSeek", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        toolCompletion("get_all_fuel_tank_levels", "call-all-tanks")
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.caller("admin").assistant.chat({
      messages: [{ role: "user", content: "แสดงปริมาณน้ำมันคงเหลือทุกถัง" }],
    });

    expect(result.answer).toContain("ปริมาณน้ำมันคงเหลือทุกถัง");
    expect(result.answer).toContain("รวมคงเหลือ");
    expect(result.answer).toContain("ไม่ได้ส่งให้ DeepSeek");
    expect(result.includeInModelContext).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const externalRequest = JSON.stringify(requestBody);
    expect(requestBody.tool_choice).toEqual({
      type: "function",
      function: { name: "get_all_fuel_tank_levels" },
    });
    expect(externalRequest).toContain("get_all_fuel_tank_levels");
    expect(externalRequest).not.toContain("ถังดีเซล B7");
    expect(externalRequest).not.toContain("3100");
  });

  it("lets admin summarize every business module without sending query results or identities to DeepSeek", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        toolCompletion(
          "get_admin_business_summary",
          "call-all-business",
          '{"section":"all"}'
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.caller("admin").assistant.chat({
      messages: [{ role: "user", content: "สรุปภาพรวมธุรกิจทุกโมดูล" }],
    });

    expect(result.answer).toContain("การเงินและค่าใช้จ่าย");
    expect(result.answer).toContain("สมาชิก ลูกค้าธุรกิจ และเครดิต");
    expect(result.answer).toContain("บุคลากรและตารางงาน");
    expect(result.answer).toContain("เอกสารและสถานะบิล");
    expect(result.answer).toContain("โครงสร้างสถานีและข้อมูลหลัก");
    expect(result.answer).toContain("Audit วันนี้");
    expect(result.answer).toContain("ไม่ได้ส่งผล query ให้ DeepSeek");
    expect(result.includeInModelContext).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    const externalRequest = String(fetchMock.mock.calls[0][1]?.body);
    expect(externalRequest).toContain("get_admin_business_summary");
    expect(externalRequest).not.toContain("สมชาย");
    expect(externalRequest).not.toContain("เจ้าของปั๊ม");
    expect(externalRequest).not.toContain("0812345678");
  });

  it("lets admin request every document as safe local actions", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        toolCompletion(
          "get_admin_documents",
          "call-documents",
          '{"document":"all"}'
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.caller("admin").assistant.chat({
      messages: [{ role: "user", content: "ขอเอกสารทั้งหมดในระบบ" }],
    });

    expect(result.answer).toContain("เอกสารที่ admin ขอผ่านแชตได้");
    expect(result.includeInModelContext).toBe(false);
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "download_daily_report" }),
        { kind: "navigate", label: "เปิดใบเสร็จรับเงิน", path: "/sales" },
        {
          kind: "navigate",
          label: "เปิดใบกำกับภาษี",
          path: "/tax-invoices",
        },
      ])
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const externalRequest = String(fetchMock.mock.calls[0][1]?.body);
    expect(externalRequest).toContain("get_admin_documents");
    expect(externalRequest).not.toContain("สมชาย");
    expect(externalRequest).not.toContain("0812345678");
  });

  it("creates a standard proposal and executes it only once after confirmation", async () => {
    const requestId = "f71e7a8d-7638-4a7c-86ea-79c1c6ad68b4";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        toolCompletion(
          "propose_pos_action",
          "call-create-member",
          JSON.stringify({
            action: "create_member",
            name: "สมาชิกทดสอบ AI",
            phone: "0899999991",
          })
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const proposal = await t.caller("cashier").assistant.chat({
      requestId,
      messages: [
        {
          role: "user",
          content: "ช่วยสมัครสมาชิกชื่อ สมาชิกทดสอบ AI เบอร์ 0899999991",
        },
      ],
    });
    const repeatedRequest = await t.caller("cashier").assistant.chat({
      requestId,
      messages: [
        {
          role: "user",
          content: "ช่วยสมัครสมาชิกชื่อ สมาชิกทดสอบ AI เบอร์ 0899999991",
        },
      ],
    });
    const action = proposal.actions.find(
      item => item.kind === "confirm_agent_action"
    );
    const repeatedAction = repeatedRequest.actions.find(
      item => item.kind === "confirm_agent_action"
    );
    expect(action).toMatchObject({
      kind: "confirm_agent_action",
      requiresPin: false,
      risk: "standard",
    });
    if (!action || action.kind !== "confirm_agent_action") {
      throw new Error("ไม่มีรายการรอยืนยัน");
    }
    expect(repeatedAction).toMatchObject({
      kind: "confirm_agent_action",
      proposalId: action.proposalId,
    });
    const persistedProposals = await t.db
      .select()
      .from(assistantActionProposals)
      .where(eq(assistantActionProposals.id, action.proposalId));
    expect(persistedProposals).toHaveLength(1);

    const first = await t.caller("cashier").assistant.executeAction({
      proposalId: action.proposalId,
    });
    const repeated = await t.caller("cashier").assistant.executeAction({
      proposalId: action.proposalId,
    });
    expect(first.alreadyExecuted).toBe(false);
    expect(repeated.alreadyExecuted).toBe(true);

    const created = await t.db
      .select()
      .from(members)
      .where(eq(members.phone, "0899999991"));
    expect(created).toHaveLength(1);
  });

  it("requires the current account PIN for sensitive proposals", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        toolCompletion(
          "propose_pos_action",
          "call-create-expense",
          JSON.stringify({
            action: "create_expense",
            title: "ค่าทดสอบ Controlled Agent",
            category: "ทดสอบ",
            amount: 125.5,
          })
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const proposal = await t.caller("admin").assistant.chat({
      messages: [
        {
          role: "user",
          content: "บันทึกค่าใช้จ่ายทดสอบ 125.50 บาท",
        },
      ],
    });
    const action = proposal.actions.find(
      item => item.kind === "confirm_agent_action"
    );
    if (!action || action.kind !== "confirm_agent_action") {
      throw new Error("ไม่มีรายการรอยืนยัน");
    }
    expect(action.requiresPin).toBe(true);

    await expect(
      t.caller("admin").assistant.executeAction({
        proposalId: action.proposalId,
        pin: "9999",
      })
    ).rejects.toThrow("PIN ไม่ถูกต้อง");

    await t.caller("admin").assistant.executeAction({
      proposalId: action.proposalId,
      pin: "1234",
    });
    const created = await t.db
      .select()
      .from(expenses)
      .where(eq(expenses.title, "ค่าทดสอบ Controlled Agent"));
    expect(created).toHaveLength(1);
  });

  it("does not expose operational tools when the staff menu permission does not allow them", async () => {
    await t.db
      .update(staffUsers)
      .set({ accessGroupId: null, menuPermissions: ["pos"] })
      .where(eq(staffUsers.id, 3));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(completion("เปิดเมนูขายหน้าลาน"));
    vi.stubGlobal("fetch", fetchMock);

    await t.caller("cashier").assistant.chat({
      messages: [{ role: "user", content: "มีสินค้าอะไรต่ำบ้าง" }],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.tools).toHaveLength(1);
    const toolNames = body.tools.map(
      (tool: { function: { name: string } }) => tool.function.name
    );
    expect(toolNames).toEqual(["open_pumppos_screen"]);
  });
});
