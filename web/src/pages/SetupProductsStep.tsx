import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Fuel, Pencil, Plus } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtMoney, fmtNum } from "@/lib/format";
import {
  setupEquipmentInput,
  setupFuelInput,
  type BusinessSetupState,
} from "@contracts/onboarding";
import {
  parseSetupProduct,
  setupErrorMessage,
  setupProductDraft,
  setupProductPatch,
  setupEquipmentDraft,
  setupEquipmentPatch,
  type SetupEquipment,
  type SetupEquipmentDraft,
  type SetupProduct,
  type SetupProductDraft,
} from "./setupForm";

type FuelDraft = {
  requestId: string;
  productId: string;
  pumpName: string;
  tankName: string;
  nozzleLabel: string;
  capacityLiters: string;
  currentLiters: string;
  lowAlertAt: string;
  meter: string;
  money: string;
};

export default function SetupProductsStep({
  state,
  onChanged,
  onBusyChange,
}: {
  state: BusinessSetupState;
  onChanged: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [productForm, setProductForm] = useState<{
    initial?: SetupProduct;
    draft: SetupProductDraft;
  } | null>(null);
  const [fuelForm, setFuelForm] = useState<FuelDraft | null>(null);
  const [equipmentForm, setEquipmentForm] = useState<{
    initial: SetupEquipment;
    draft: SetupEquipmentDraft;
  } | null>(null);
  const [error, setError] = useState("");
  const [productError, setProductError] = useState("");
  const [fuelError, setFuelError] = useState("");
  const [equipmentError, setEquipmentError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const createProduct = trpc.catalog.createProduct.useMutation();
  const updateProduct = trpc.catalog.updateProduct.useMutation();
  const createFuel = trpc.onboarding.createFuelSetup.useMutation();
  const updateEquipment = trpc.onboarding.updateEquipment.useMutation();
  const busy =
    createProduct.isPending ||
    updateProduct.isPending ||
    createFuel.isPending ||
    updateEquipment.isPending ||
    refreshing;
  const fuelProducts = state.products.filter(
    product => product.active && product.category === "fuel"
  );

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  const refreshAfterSave = async (message: string) => {
    setRefreshing(true);
    setNotice(message);
    try {
      await onChanged();
      setError("");
    } catch {
      setError("ข้อมูลบันทึกแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ กรุณากดโหลดใหม่");
    } finally {
      setRefreshing(false);
    }
  };
  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!productForm || busy) return;
    setProductError("");
    try {
      if (productForm.initial) {
        const patch = setupProductPatch(productForm.draft, productForm.initial);
        if (Object.keys(patch).length > 1)
          await updateProduct.mutateAsync({
            ...patch,
            expectedBranchId: state.branch.id,
          });
      } else {
        const {
          id: _id,
          active: _active,
          ...input
        } = parseSetupProduct(productForm.draft);
        await createProduct.mutateAsync({
          ...input,
          expectedBranchId: state.branch.id,
        });
      }
      setProductForm(null);
      await refreshAfterSave("บันทึกสินค้าแล้ว");
    } catch (failure) {
      setProductError(setupErrorMessage(failure));
    }
  };
  const saveFuel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!fuelForm || busy) return;
    setFuelError("");
    try {
      const numericFields = [
        "capacityLiters",
        "currentLiters",
        "lowAlertAt",
        "meter",
        "money",
      ] as const;
      for (const field of numericFields) {
        if (!fuelForm[field].trim())
          throw new Error(
            "กรุณาระบุความจุ ระดับน้ำมัน จุดแจ้งเตือน และเลข L/P ตามค่าจริง ใส่ 0 ได้เมื่อค่าจริงเป็น 0"
          );
      }
      const input = setupFuelInput.safeParse({
        ...fuelForm,
        expectedBranchId: state.branch.id,
        productId: Number(fuelForm.productId),
        capacityLiters: Number(fuelForm.capacityLiters),
        currentLiters: Number(fuelForm.currentLiters),
        lowAlertAt: Number(fuelForm.lowAlertAt),
        meter: Number(fuelForm.meter),
        money: Number(fuelForm.money),
      });
      if (!input.success)
        throw new Error(
          input.error.issues[0]?.message ?? "ตรวจสอบข้อมูลถังและหัวจ่ายอีกครั้ง"
        );
      await createFuel.mutateAsync(input.data);
      setFuelForm(null);
      await refreshAfterSave("บันทึกถัง ตู้จ่าย และหัวจ่ายแล้ว");
    } catch (failure) {
      setFuelError(setupErrorMessage(failure));
    }
  };
  const editDraft = <Key extends keyof SetupProductDraft>(
    key: Key,
    value: SetupProductDraft[Key]
  ) => {
    setProductForm(current =>
      current
        ? { ...current, draft: { ...current.draft, [key]: value } }
        : current
    );
  };
  const saveEquipment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!equipmentForm || busy || state.hasOpenShift) return;
    setEquipmentError("");
    try {
      const patch = setupEquipmentPatch(
        equipmentForm.draft,
        equipmentForm.initial
      );
      if (Object.keys(patch).length > 1) {
        const input = setupEquipmentInput.safeParse({
          ...patch,
          expectedBranchId: state.branch.id,
        });
        if (!input.success)
          throw new Error(
            input.error.issues[0]?.message ?? "ตรวจข้อมูลหัวจ่ายและถังอีกครั้ง"
          );
        await updateEquipment.mutateAsync(input.data);
      }
      setEquipmentForm(null);
      await refreshAfterSave("บันทึกหัวจ่ายและค่าถังจริงแล้ว");
    } catch (failure) {
      setEquipmentError(setupErrorMessage(failure));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">
            สินค้าและหัวจ่ายจริงของสาขา
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ตรวจราคาขาย ต้นทุน และจำนวนคงเหลือก่อนยืนยัน
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setProductError("");
            setProductForm({ draft: setupProductDraft() });
          }}
        >
          <Plus className="mr-2 size-4" /> เพิ่มสินค้า
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-sm text-destructive"
        >
          {error}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void refreshAfterSave(notice)}
          >
            โหลดใหม่
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {state.products.map(product => (
          <Card key={product.id} className="py-4">
            <CardContent className="space-y-3 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words font-medium">{product.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {product.code} ·{" "}
                    {product.category === "fuel"
                      ? "น้ำมัน"
                      : product.category === "lubricant"
                        ? "น้ำมันเครื่อง"
                        : "สินค้าอื่น"}
                  </div>
                </div>
                <Badge variant={product.active ? "secondary" : "outline"}>
                  {product.active ? "ขายอยู่" : "พักขาย"}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  ขาย ฿{fmtMoney(product.price)} / {product.unit}
                </div>
                <div>ต้นทุน ฿{fmtMoney(product.cost)}</div>
                {product.category !== "fuel" && (
                  <div className="col-span-2 text-muted-foreground">
                    คงเหลือ {fmtNum(product.stockQty)} {product.unit}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setProductError("");
                  setProductForm({
                    initial: { ...product },
                    draft: setupProductDraft(product),
                  });
                }}
              >
                <Pencil className="mr-2 size-4" /> ตรวจและแก้ไขสินค้า
              </Button>
            </CardContent>
          </Card>
        ))}
        {!state.products.length && (
          <p className="py-5 text-sm text-muted-foreground">
            ยังไม่มีสินค้า เพิ่มสินค้าที่ขายจริงก่อนเริ่มงาน
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <h3 className="font-heading font-semibold">
          ถังและเลขมิเตอร์ของหัวจ่าย
        </h3>
        <Button
          variant="outline"
          disabled={busy || state.hasOpenShift || !fuelProducts.length}
          onClick={() => {
            setFuelError("");
            setFuelForm({
              requestId: crypto.randomUUID(),
              productId: String(fuelProducts[0].id),
              pumpName: "",
              tankName: "",
              nozzleLabel: "",
              capacityLiters: "",
              currentLiters: "",
              lowAlertAt: "",
              meter: "",
              money: "",
            });
          }}
        >
          <Fuel className="mr-2 size-4" /> เพิ่มถังและหัวจ่าย
        </Button>
      </div>
      {state.hasOpenShift && (
        <p className="text-sm text-muted-foreground">
          มีกะเปิดอยู่ ต้องปิดกะก่อนเพิ่มหรือเปลี่ยนหัวจ่าย
        </p>
      )}
      {!fuelProducts.length && (
        <p className="text-sm text-muted-foreground">
          เพิ่มและเปิดขายสินค้าประเภทน้ำมันก่อนตั้งถังและหัวจ่าย
        </p>
      )}
      {state.equipment.map(item => (
        <div key={item.id} className="rounded-xl border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium">
              {item.label} · {item.productName}
            </div>
            <Badge
              variant={item.valid && item.active ? "secondary" : "outline"}
            >
              {!item.active
                ? "พักหัวจ่าย"
                : item.valid
                  ? "ผูกถังแล้ว"
                  : "ต้องตรวจแก้"}
            </Badge>
          </div>
          <div className="mt-2 text-muted-foreground">
            {item.pumpName} · {item.tankName || "ยังไม่ระบุถัง"}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>L · ลิตรสะสม {fmtNum(item.meter)} ลิตร</div>
            <div>P · เงินสะสม ฿{fmtMoney(item.money)}</div>
            <div className="sm:col-span-2">
              น้ำมันในถัง {fmtNum(item.currentLiters)} /{" "}
              {fmtNum(item.capacityLiters)} ลิตร
            </div>
          </div>
          {!!item.issues.length && (
            <ul className="mt-2 list-inside list-disc text-destructive">
              {item.issues.map(issue => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            disabled={busy || state.hasOpenShift || !state.branch.active}
            onClick={() => {
              setEquipmentError("");
              setEquipmentForm({
                initial: { ...item },
                draft: setupEquipmentDraft(item),
              });
            }}
          >
            <Pencil className="size-4" /> ตรวจและแก้ไขหัวจ่าย
          </Button>
        </div>
      ))}
      {!state.equipment.length && (
        <p className="text-sm text-muted-foreground">
          ยังไม่มีหัวจ่าย ต้องผูกน้ำมันกับถังและบันทึกเลข L/P จริงก่อนเปิดกะ
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          to="/settings"
          className="text-primary underline underline-offset-4"
        >
          ตั้งค่าอุปกรณ์ขั้นสูง
        </Link>
        <Link to="/stock" className="text-primary underline underline-offset-4">
          ตรวจระดับน้ำมันในถัง
        </Link>
      </div>

      <Dialog
        open={Boolean(productForm)}
        onOpenChange={open => {
          if (!open && !busy) setProductForm(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {productForm?.initial ? "ตรวจและแก้ไขสินค้า" : "เพิ่มสินค้า"}
            </DialogTitle>
            <DialogDescription>
              ราคาขายและต้นทุนเป็นบาทต่อหน่วย ใช้ค่าจริงของกิจการ
            </DialogDescription>
          </DialogHeader>
          {productForm && (
            <form
              onSubmit={event => void saveProduct(event)}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="setup-product-code">รหัสสินค้า</Label>
                  <Input
                    id="setup-product-code"
                    required
                    value={productForm.draft.code}
                    disabled={busy || Boolean(productForm.initial)}
                    onChange={event => editDraft("code", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-product-name">ชื่อสินค้า</Label>
                  <Input
                    id="setup-product-name"
                    required
                    value={productForm.draft.name}
                    disabled={busy}
                    onChange={event => editDraft("name", event.target.value)}
                  />
                </div>
              </div>
              {!productForm.initial && (
                <div className="space-y-2">
                  <Label htmlFor="setup-product-category">ประเภท</Label>
                  <Select
                    value={productForm.draft.category}
                    disabled={busy}
                    onValueChange={value => {
                      editDraft("category", value as SetupProduct["category"]);
                      editDraft("unit", value === "fuel" ? "ลิตร" : "ชิ้น");
                    }}
                  >
                    <SelectTrigger id="setup-product-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fuel">น้ำมัน</SelectItem>
                      <SelectItem value="lubricant">น้ำมันเครื่อง</SelectItem>
                      <SelectItem value="other">สินค้าอื่น</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="setup-product-price">ราคาขาย (บาท)</Label>
                  <Input
                    id="setup-product-price"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={productForm.draft.price}
                    disabled={busy}
                    onChange={event => editDraft("price", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-product-cost">ต้นทุน (บาท)</Label>
                  <Input
                    id="setup-product-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={productForm.draft.cost}
                    disabled={busy}
                    onChange={event => editDraft("cost", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setup-product-unit">หน่วยขาย</Label>
                  <Input
                    id="setup-product-unit"
                    required
                    value={productForm.draft.unit}
                    disabled={busy || Boolean(productForm.initial)}
                    onChange={event => editDraft("unit", event.target.value)}
                  />
                </div>
                {productForm.draft.category !== "fuel" && (
                  <div className="space-y-2">
                    <Label htmlFor="setup-product-stock">จำนวนคงเหลือ</Label>
                    <Input
                      id="setup-product-stock"
                      type="number"
                      min="0"
                      step="0.001"
                      required
                      value={productForm.draft.stockQty}
                      disabled={busy}
                      onChange={event =>
                        editDraft("stockQty", event.target.value)
                      }
                    />
                  </div>
                )}
              </div>
              {productForm.initial && (
                <label className="flex min-h-11 items-center gap-2">
                  <Checkbox
                    checked={productForm.draft.active}
                    disabled={busy}
                    onCheckedChange={value =>
                      editDraft("active", value === true)
                    }
                  />{" "}
                  เปิดขายสินค้านี้
                </label>
              )}
              {productError && (
                <p role="alert" className="text-sm text-destructive">
                  {productError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setProductForm(null)}
                >
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "กำลังบันทึก..." : "บันทึกสินค้า"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(equipmentForm)}
        onOpenChange={open => {
          if (!open && !busy) setEquipmentForm(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>ตรวจและแก้ไขหัวจ่าย</DialogTitle>
            <DialogDescription>
              {equipmentForm?.initial.productName} ·{" "}
              {equipmentForm?.initial.pumpName} ·
              ค่าถังที่แก้จะใช้ร่วมกับทุกหัวจ่ายที่ผูกถังนี้
            </DialogDescription>
          </DialogHeader>
          {equipmentForm && (
            <form
              noValidate
              className="space-y-4"
              onSubmit={event => void saveEquipment(event)}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["label", "ชื่อหัวจ่าย", false],
                    ["tankName", "ชื่อถังน้ำมัน", false],
                    ["meter", "L · เลขลิตรสะสมบนหน้าตู้", true],
                    ["money", "P · เลขเงินสะสมบนหน้าตู้ (บาท)", true],
                    ["capacityLiters", "ความจุถัง (ลิตร)", true],
                    ["currentLiters", "น้ำมันในถังตอนนี้ (ลิตร)", true],
                    ["lowAlertAt", "เตือนเมื่อน้ำมันต่ำกว่า (ลิตร)", true],
                  ] as const
                ).map(([key, label, numeric]) => (
                  <div className="space-y-2" key={key}>
                    <Label htmlFor={`setup-equipment-${key}`}>{label}</Label>
                    <Input
                      id={`setup-equipment-${key}`}
                      type={numeric ? "number" : "text"}
                      required
                      min={
                        numeric
                          ? key === "capacityLiters"
                            ? 0.001
                            : 0
                          : undefined
                      }
                      step={
                        numeric ? (key === "money" ? 0.01 : 0.001) : undefined
                      }
                      maxLength={numeric ? undefined : 100}
                      value={equipmentForm.draft[key]}
                      disabled={busy}
                      onChange={event =>
                        setEquipmentForm(current =>
                          current
                            ? {
                                ...current,
                                draft: {
                                  ...current.draft,
                                  [key]: event.target.value,
                                },
                              }
                            : current
                        )
                      }
                    />
                  </div>
                ))}
              </div>
              <label className="flex min-h-11 items-center gap-2">
                <Checkbox
                  checked={equipmentForm.draft.active}
                  disabled={busy}
                  onCheckedChange={value =>
                    setEquipmentForm(current =>
                      current
                        ? {
                            ...current,
                            draft: { ...current.draft, active: value === true },
                          }
                        : current
                    )
                  }
                />{" "}
                ใช้งานหัวจ่ายนี้
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                L/P เป็นเลขสะสมบนหน้าตู้ ไม่ใช่ยอดขายวันนี้
                ตรวจจากค่าจริงก่อนบันทึก
              </p>
              {equipmentError && (
                <p role="alert" className="text-sm text-destructive">
                  {equipmentError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEquipmentForm(null)}
                >
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={busy || state.hasOpenShift}>
                  {busy ? "กำลังบันทึก…" : "บันทึกหัวจ่ายและถัง"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(fuelForm)}
        onOpenChange={open => {
          if (!open && !busy) setFuelForm(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>เพิ่มถัง ตู้จ่าย และหัวจ่าย</DialogTitle>
            <DialogDescription>
              บันทึกอุปกรณ์ชุดใหม่พร้อมกัน ระบุค่าจริงจากถังและหน้าตู้
              ไม่ใช้ข้อมูลตัวอย่าง
            </DialogDescription>
          </DialogHeader>
          {fuelForm && (
            <form
              onSubmit={event => void saveFuel(event)}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="setup-fuel-product">
                  น้ำมันที่หัวจ่ายนี้ขาย
                </Label>
                <Select
                  value={fuelForm.productId}
                  disabled={busy}
                  onValueChange={value =>
                    setFuelForm(current =>
                      current ? { ...current, productId: value } : current
                    )
                  }
                >
                  <SelectTrigger id="setup-fuel-product">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fuelProducts.map(product => (
                      <SelectItem key={product.id} value={String(product.id)}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["pumpName", "ชื่อตู้จ่าย", false],
                  ["tankName", "ชื่อถังน้ำมัน", false],
                  ["nozzleLabel", "ชื่อหัวจ่าย", false],
                  ["capacityLiters", "ความจุถัง (ลิตร)", true],
                  ["currentLiters", "น้ำมันในถังตอนนี้ (ลิตร)", true],
                  ["lowAlertAt", "เตือนเมื่อน้ำมันต่ำกว่า (ลิตร)", true],
                  ["meter", "L · เลขลิตรสะสมบนหน้าตู้", true],
                  ["money", "P · เลขเงินสะสมบนหน้าตู้ (บาท)", true],
                ].map(([key, label, numeric]) => (
                  <div className="space-y-2" key={String(key)}>
                    <Label htmlFor={`setup-fuel-${key}`}>{label}</Label>
                    <Input
                      id={`setup-fuel-${key}`}
                      required
                      type={numeric ? "number" : "text"}
                      min={
                        numeric
                          ? key === "capacityLiters"
                            ? 0.001
                            : 0
                          : undefined
                      }
                      step={
                        numeric ? (key === "money" ? 0.01 : 0.001) : undefined
                      }
                      maxLength={numeric ? undefined : 100}
                      value={fuelForm[key as keyof FuelDraft]}
                      disabled={busy}
                      onChange={event =>
                        setFuelForm(current =>
                          current
                            ? { ...current, [String(key)]: event.target.value }
                            : current
                        )
                      }
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                L/P เป็นมิเตอร์สะสม ไม่ใช่ยอดขายของวันนี้ ใส่ 0
                เฉพาะเมื่อค่าจริงบนหน้าตู้เป็น 0
              </p>
              {fuelError && (
                <p role="alert" className="text-sm text-destructive">
                  {fuelError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setFuelForm(null)}
                >
                  ยกเลิก
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "กำลังบันทึก..." : "บันทึกอุปกรณ์"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
