import { describe, expect, it, vi } from "vitest";
import {
  lookupRevenueDepartmentTaxpayer,
  RevenueDepartmentUnavailableError,
  TaxpayerNotFoundError,
} from "./revenueDepartment";

function soapResponse(payload: Record<string, unknown>): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><ServiceResponse xmlns="https://rdws.rd.go.th/JserviceRD3/vatserviceRD3"><ServiceResult>${JSON.stringify(payload).replace(/&/g, "&amp;")}</ServiceResult></ServiceResponse></soap:Body></soap:Envelope>`;
}

describe("Revenue Department VAT lookup", () => {
  it("maps the official response into invoice-ready customer data", async () => {
    let requestBody = "";
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        requestBody = String(init?.body ?? "");
        return new Response(
          soapResponse({
            NID: ["0107544000108"],
            TitleName: ["บริษัท"],
            Name: ["ปตท. จำกัด (มหาชน)"],
            Surname: ["-"],
            BranchTitleName: ["บริษัท"],
            BranchName: ["ปตท. จำกัด (มหาชน)"],
            BranchNumber: [0],
            BuildingName: ["-"],
            RoomNumber: ["-"],
            FloorNumber: ["-"],
            VillageName: ["-"],
            HouseNumber: ["555"],
            MooNumber: ["-"],
            SoiName: ["-"],
            Yaek: ["-"],
            StreetName: ["วิภาวดีรังสิต"],
            Thambol: ["จตุจักร"],
            Amphur: ["จตุจักร"],
            Province: ["กรุงเทพมหานคร"],
            PostCode: ["10900"],
            msgerr: [],
          }),
          { status: 200 }
        );
      }
    );

    const result = await lookupRevenueDepartmentTaxpayer(
      { taxId: "0107544000108" },
      { fetchImpl: fetchMock }
    );

    expect(result).toMatchObject({
      taxId: "0107544000108",
      name: "บริษัท ปตท. จำกัด (มหาชน)",
      branchType: "hq",
      branchNo: "",
      address:
        "เลขที่ 555 ถนนวิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพมหานคร 10900",
      source: "rd-vat",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestBody).toContain("<vat:TIN>0107544000108</vat:TIN>");
  });

  it("selects and formats an exact branch", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          soapResponse({
            NID: ["0100000000001"],
            BranchTitleName: ["บริษัท"],
            BranchName: ["ตัวอย่าง จำกัด"],
            BranchNumber: [78],
            HouseNumber: ["99"],
            Thambol: ["สุเทพ"],
            Amphur: ["เมืองเชียงใหม่"],
            Province: ["เชียงใหม่"],
            PostCode: ["50200"],
            msgerr: [],
          }),
          { status: 200 }
        )
    );

    const result = await lookupRevenueDepartmentTaxpayer(
      { taxId: "0100000000001", branchNumber: 78 },
      { fetchImpl: fetchMock }
    );

    expect(result.branchType).toBe("branch");
    expect(result.branchNo).toBe("00078");
    expect(result.address).toBe(
      "เลขที่ 99 ตำบลสุเทพ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200"
    );
  });

  it("reports a taxpayer that is not in the VAT registry", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(soapResponse({ NID: [], BranchNumber: [], msgerr: [] }), {
          status: 200,
        })
    );

    await expect(
      lookupRevenueDepartmentTaxpayer(
        { taxId: "1100000000001" },
        { fetchImpl: fetchMock }
      )
    ).rejects.toBeInstanceOf(TaxpayerNotFoundError);
  });

  it("handles an invalid upstream response without leaking its body", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>error</html>"));

    await expect(
      lookupRevenueDepartmentTaxpayer(
        { taxId: "0100000000001" },
        { fetchImpl: fetchMock }
      )
    ).rejects.toBeInstanceOf(RevenueDepartmentUnavailableError);
  });
});
