import { useRef, useState, type ChangeEvent } from "react";
import {
  Settings as SettingsIcon,
  Store,
  Fuel,
  UserCog,
  UsersRound,
  Plus,
  Pencil,
  Gift,
  Trash2,
  Gauge,
  FileText,
  ImagePlus,
  Database,
  History,
  Save,
  Printer,
  Network,
  Copy,
  Cloud,
  Download,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import {
  fmtMoney,
  fmtNum,
  fmtDateTime,
  categoryLabel,
  roleLabel,
} from "@/lib/format";
import { createInitialSettingsForm } from "./settingsForm";
import type { Product } from "@db/schema";
import {
  MENU_PERMISSION_DEFINITIONS,
  MENU_PERMISSION_GROUP_LABELS,
  getRoleMenuPermissions,
  isRoleEligibleForMenu,
  normalizeMenuPermissions,
  type MenuPermissionGroup,
  type MenuPermissionKey,
  type StaffRole,
} from "@contracts/menuPermissions";

function staffMenuPermissions(
  role: StaffRole,
  value: unknown
): MenuPermissionKey[] {
  const stored = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
  return normalizeMenuPermissions(role, stored);
}

const emptyProduct = {
  code: "",
  name: "",
  category: "other" as "fuel" | "lubricant" | "other",
  unit: "ชิ้น",
  price: 0,
  cost: 0,
  stockQty: 0,
  lowStockAt: 0,
};

function fmtFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function backupTriggerLabel(
  trigger: "manual" | "scheduled" | "monthly"
): string {
  if (trigger === "manual") return "สั่งสำรองเอง";
  if (trigger === "monthly") return "สำเนารายเดือน";
  return "อัตโนมัติ";
}

type BackupSelection = {
  objectName: string;
  fileName: string;
  sha256: string;
  trigger: "manual" | "scheduled" | "monthly";
};

type AccessGroupForm = {
  id?: number;
  name: string;
  description: string;
  role: "manager" | "cashier";
  menuPermissions: MenuPermissionKey[];
};

type BranchOption = {
  id: number;
  code: string;
  name: string;
};

function StaffBranchSelector({
  branches,
  value,
  onChange,
}: {
  branches: readonly BranchOption[];
  value: readonly number[];
  onChange: (branchIds: number[]) => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border bg-slate-50/70 p-3">
      <Label>สาขาที่เข้าใช้งานได้</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {branches.map(branch => {
          const checked = value.includes(branch.id);
          return (
            <label
              key={branch.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? value.filter(id => id !== branch.id)
                      : [...value, branch.id]
                  )
                }
                className="size-4 accent-violet-600"
              />
              <span className="font-medium">{branch.code}</span>
              <span className="truncate text-muted-foreground">
                {branch.name}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function MenuPermissionEditor({
  role,
  value,
  onChange,
}: {
  role: StaffRole;
  value: MenuPermissionKey[];
  onChange: (permissions: MenuPermissionKey[]) => void;
}) {
  if (role === "admin") {
    return (
      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-800">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4" /> ผู้ดูแลระบบใช้ได้ทุกเมนู
        </div>
        <p className="mt-1 text-xs text-violet-700/80">
          สิทธิ์ของ admin จะเปิดครบเสมอเพื่อป้องกันระบบไม่มีผู้ดูแล
        </p>
      </div>
    );
  }

  const eligible = MENU_PERMISSION_DEFINITIONS.filter(item =>
    isRoleEligibleForMenu(role, item.key)
  );
  const selected = new Set(value);
  const groups: MenuPermissionGroup[] = [
    "station",
    "customer",
    "document",
    "system",
  ];

  return (
    <div className="space-y-3 rounded-2xl border bg-slate-50/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">เมนูที่อนุญาตให้ใช้งาน</div>
          <div className="text-xs text-muted-foreground">
            เมนูที่ปิดจะไม่แสดงและเปิดด้วย URL โดยตรงไม่ได้
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange(eligible.map(item => item.key))}
          >
            เปิดทั้งหมด
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange([])}
          >
            ปิดทั้งหมด
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map(group => {
          const items = eligible.filter(item => item.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className="rounded-xl border bg-white p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">
                {MENU_PERMISSION_GROUP_LABELS[group]}
              </div>
              <div className="space-y-2.5">
                {items.map(item => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-center justify-between gap-3 text-sm"
                  >
                    <span>{item.label}</span>
                    <Switch
                      checked={selected.has(item.key)}
                      onCheckedChange={checked =>
                        onChange(
                          checked
                            ? [...value, item.key]
                            : value.filter(key => key !== item.key)
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {value.length === 0 && (
        <p className="text-xs font-medium text-destructive">
          กรุณาเปิดอย่างน้อย 1 เมนูก่อนบันทึก
        </p>
      )}
    </div>
  );
}

type AccessGroupOption = {
  id: number;
  name: string;
  role: "manager" | "cashier";
  menuPermissions: MenuPermissionKey[];
};

function StaffGroupBadge({
  groupId,
  groups,
}: {
  groupId: unknown;
  groups: AccessGroupOption[];
}) {
  const group =
    typeof groupId === "number"
      ? groups.find(item => item.id === groupId)
      : null;
  return group ? (
    <span className="rounded-full bg-violet-50 px-1.5 py-0.5 font-medium">
      กลุ่ม {group.name}
    </span>
  ) : null;
}

function StaffAccessSelector({
  role,
  accessGroupId,
  menuPermissions,
  groups,
  onGroupChange,
  onPermissionsChange,
}: {
  role: StaffRole;
  accessGroupId: number | null;
  menuPermissions: MenuPermissionKey[];
  groups: AccessGroupOption[];
  onGroupChange: (groupId: number | null) => void;
  onPermissionsChange: (permissions: MenuPermissionKey[]) => void;
}) {
  if (role === "admin") {
    return (
      <MenuPermissionEditor
        role={role}
        value={menuPermissions}
        onChange={onPermissionsChange}
      />
    );
  }

  const eligibleGroups = groups.filter(group => group.role === role);
  const selectedGroup = eligibleGroups.find(
    group => group.id === accessGroupId
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>กลุ่มสิทธิ์</Label>
        <Select
          value={accessGroupId ? String(accessGroupId) : "individual"}
          onValueChange={value =>
            onGroupChange(value === "individual" ? null : Number(value))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="individual">กำหนดเฉพาะผู้ใช้คนนี้</SelectItem>
            {eligibleGroups.map(group => (
              <SelectItem key={group.id} value={String(group.id)}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          เมื่อเลือกกลุ่ม ผู้ใช้จะรับการเปลี่ยนแปลงสิทธิ์ของกลุ่มโดยอัตโนมัติ
        </p>
      </div>

      {selectedGroup ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-800">
            <UsersRound className="size-4" /> รับสิทธิ์จากกลุ่ม{" "}
            {selectedGroup.name}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MENU_PERMISSION_DEFINITIONS.filter(item =>
              selectedGroup.menuPermissions.includes(item.key)
            ).map(item => (
              <span
                key={item.key}
                className="rounded-full bg-white px-2 py-1 text-[11px] text-violet-700 ring-1 ring-violet-100"
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <MenuPermissionEditor
          role={role}
          value={menuPermissions}
          onChange={onPermissionsChange}
        />
      )}
    </div>
  );
}

export default function Settings() {
  const { staff } = useStaff();
  const utils = trpc.useUtils();
  const isAdmin = staff?.role === "admin";
  const isDesktop = typeof window !== "undefined" && !!window.posDesktop;
  const settingsSaveInFlight = useRef(false);

  // โพลทุก 5 วิ — ค่าที่แสดงสดใกล้ realtime: แก้จากเครื่องอื่น (multi-station) หรือที่อื่นแล้วหน้านี้อัปเดตเอง
  // หยุดโพลระหว่างบันทึก ป้องกัน request เก่าตอบกลับมาทับค่าที่เพิ่งบันทึก
  const {
    data: settingMap,
    isPending: settingsPending,
    isError: settingsError,
    error: settingsQueryError,
    refetch: refetchSettings,
  } = trpc.catalog.getSettings.useQuery(undefined, {
    refetchInterval: () => (settingsSaveInFlight.current ? false : 5000),
  });
  const { data: shopLogo } = trpc.catalog.getShopLogo.useQuery();
  const { data: products } = trpc.catalog.listProducts.useQuery();
  const { data: publicStaffList } = trpc.auth.listStaff.useQuery();
  const { data: staffAccessList } = trpc.auth.listStaffAccess.useQuery(
    undefined,
    {
      enabled: isAdmin,
    }
  );
  const { data: allBranches } = trpc.auth.listAllBranches.useQuery(undefined, {
    enabled: isAdmin,
  });
  const { data: accessGroups } = trpc.auth.listAccessGroups.useQuery(
    undefined,
    {
      enabled: isAdmin,
    }
  );
  const staffList = isAdmin ? staffAccessList : publicStaffList;
  const { data: rewards } = trpc.membership.listRewards.useQuery();
  const { data: pumps } = trpc.catalog.listPumps.useQuery();
  const { data: tanks } = trpc.catalog.listTanks.useQuery();
  const { data: lanInfo } = trpc.catalog.lanInfo.useQuery();

  // Layout เรียก getSettings ไว้ก่อนแล้วบ่อยครั้ง query จึงมีข้อมูลใน cache ตั้งแต่ render แรก
  // ต้องนำ cache มาเป็นค่าเริ่มต้นทันที ไม่เช่นนั้น prevSettingMap จะเท่ากันและฟอร์มจะค้างเป็น {}
  const [form, setForm] = useState<Record<string, string>>(() =>
    createInitialSettingsForm(settingMap)
  );
  const [logoData, setLogoData] = useState<string | null>(null); // null=ไม่เปลี่ยน, ""=ลบโลโก้, อื่นๆ=data URL ใหม่
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [editP, setEditP] = useState<
    (Partial<Product> & typeof emptyProduct) | null
  >(null);
  const [histP, setHistP] = useState<Product | null>(null); // สินค้าที่กำลังดูประวัติเปลี่ยนราคา
  const { data: priceHist } = trpc.catalog.priceHistory.useQuery(
    { productId: histP?.id ?? 0 },
    { enabled: histP != null }
  );
  const [showStaff, setShowStaff] = useState(false);
  const [showBranch, setShowBranch] = useState(false);
  const [newBranch, setNewBranch] = useState({
    code: "",
    name: "",
    address: "",
    phone: "",
    taxId: "",
    cloneCurrentSetup: true,
  });
  const [editAccessGroup, setEditAccessGroup] =
    useState<AccessGroupForm | null>(null);
  const [newStaff, setNewStaff] = useState({
    username: "",
    pin: "",
    name: "",
    role: "cashier" as "admin" | "manager" | "cashier",
    accessGroupId: null as number | null,
    menuPermissions: getRoleMenuPermissions("cashier"),
    branchIds: staff?.branch.id ? [staff.branch.id] : ([] as number[]),
  });
  const [editS, setEditS] = useState<{
    id: number;
    username: string;
    name: string;
    role: "admin" | "manager" | "cashier";
    accessGroupId: number | null;
    pin: string;
    menuPermissions: MenuPermissionKey[];
    branchIds: number[];
  } | null>(null);
  const [editN, setEditN] = useState<{
    id: number;
    label: string;
    productId: number;
    tankId: number | null;
    meter: number;
    money: number;
  } | null>(null);
  const [editR, setEditR] = useState<{
    id?: number;
    name: string;
    pointsRequired: number;
    stock: number;
  } | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [downloadingBackup, setDownloadingBackup] = useState("");
  const [restoreBackupTarget, setRestoreBackupTarget] =
    useState<BackupSelection | null>(null);
  const [deleteBackupTarget, setDeleteBackupTarget] =
    useState<BackupSelection | null>(null);
  const [deleteBackupConfirmation, setDeleteBackupConfirmation] = useState("");

  // sync ฟอร์มจาก settingMap ด้วย pattern adjust-state-during-render (แทน useEffect เพื่อเลี่ยง cascading render)
  // merge แบบเก็บ keys ที่แก้ค้างไว้ (ค่าต่างจาก snapshot รอบก่อนและยังไม่ตรง server รอบใหม่)
  // — กัน refetch (TanStack refetch ตอน window focus) ล้างค่าที่ยังไม่บันทึก
  const [prevSettingMap, setPrevSettingMap] = useState(settingMap);
  if (settingMap !== prevSettingMap) {
    setPrevSettingMap(settingMap);
    if (settingMap) {
      setForm(f => {
        const merged = { ...settingMap };
        for (const k of Object.keys(f)) {
          // ยังไม่เคยโหลด settingMap — ทุก key ในฟอร์มคือการแก้ของผู้ใช้ เก็บไว้ทั้งหมด
          if (!prevSettingMap) {
            merged[k] = f[k];
            continue;
          }
          if (
            f[k] !== (prevSettingMap[k] ?? "") &&
            f[k] !== (settingMap[k] ?? "")
          )
            merged[k] = f[k];
        }
        return merged;
      });
    }
  }

  const ok = (m: string) => {
    setMsg(m);
    setErr("");
    setTimeout(() => setMsg(""), 3000);
  };
  const fail = (m: string) => {
    setErr(m);
    setMsg("");
  };

  const saveSettings = trpc.catalog.updateSettings.useMutation({
    onMutate: async () => {
      // request polling อาจเริ่มก่อนกดบันทึกและถือค่าเก่าอยู่ ต้องยกเลิกก่อนเขียนค่าใหม่
      settingsSaveInFlight.current = true;
      await utils.catalog.getSettings.cancel();
    },
    onSuccess: result => {
      // ใช้ค่าที่ API อ่านกลับจาก PostgreSQL เป็น source of truth และไม่ invalidate ซ้ำทันที
      // เพราะ invalidate อาจไปรอ request เก่าที่กำลังวิ่งอยู่แล้วนำค่าเก่ากลับมาทับหน้าจอ
      setPrevSettingMap(result.settings);
      setForm(result.settings);
      utils.catalog.getSettings.setData(undefined, result.settings);
      void utils.catalog.getShopLogo.invalidate();
      void utils.catalog.lanInfo.invalidate();
      setLogoData(null);
      ok("บันทึกการตั้งค่าลงฐานข้อมูลแล้ว");
    },
    onError: e => fail(e.message),
    onSettled: () => {
      settingsSaveInFlight.current = false;
    },
  });
  const saveProduct = trpc.catalog.updateProduct.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      setEditP(null);
      ok("บันทึกสินค้าแล้ว");
    },
    onError: e => fail(e.message),
  });
  const createProduct = trpc.catalog.createProduct.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      setEditP(null);
      ok("เพิ่มสินค้าแล้ว");
    },
    onError: e => fail(e.message),
  });
  const createStaff = trpc.auth.createStaff.useMutation({
    onSuccess: () => {
      utils.auth.listStaff.invalidate();
      utils.auth.listStaffAccess.invalidate();
      utils.auth.listAccessGroups.invalidate();
      setShowStaff(false);
      setNewStaff({
        username: "",
        pin: "",
        name: "",
        role: "cashier",
        accessGroupId: null,
        menuPermissions: getRoleMenuPermissions("cashier"),
        branchIds: staff?.branch.id ? [staff.branch.id] : [],
      });
      ok("เพิ่มพนักงานแล้ว");
    },
    onError: e => fail(e.message),
  });
  const createBranch = trpc.auth.createBranch.useMutation({
    onSuccess: () => {
      void utils.auth.listAllBranches.invalidate();
      void utils.auth.listBranches.invalidate();
      setShowBranch(false);
      setNewBranch({
        code: "",
        name: "",
        address: "",
        phone: "",
        taxId: "",
        cloneCurrentSetup: true,
      });
      ok("เพิ่มสาขาแล้ว");
    },
    onError: e => fail(e.message),
  });
  const updateBranch = trpc.auth.updateBranch.useMutation({
    onSuccess: () => {
      void utils.auth.listAllBranches.invalidate();
      void utils.auth.listBranches.invalidate();
      ok("อัปเดตสถานะสาขาแล้ว");
    },
    onError: e => fail(e.message),
  });
  const updateStaff = trpc.auth.updateStaff.useMutation({
    onSuccess: () => {
      utils.auth.listStaff.invalidate();
      utils.auth.listStaffAccess.invalidate();
      utils.auth.listAccessGroups.invalidate();
      setEditS(null);
      ok("แก้ไขพนักงานแล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteStaff = trpc.auth.deleteStaff.useMutation({
    onSuccess: () => {
      utils.auth.listStaff.invalidate();
      utils.auth.listStaffAccess.invalidate();
      utils.auth.listAccessGroups.invalidate();
      ok("ลบพนักงานแล้ว");
    },
    onError: e => fail(e.message),
  });
  const createAccessGroup = trpc.auth.createAccessGroup.useMutation({
    onSuccess: () => {
      utils.auth.listAccessGroups.invalidate();
      setEditAccessGroup(null);
      ok("เพิ่มกลุ่มสิทธิ์แล้ว");
    },
    onError: e => fail(e.message),
  });
  const updateAccessGroup = trpc.auth.updateAccessGroup.useMutation({
    onSuccess: () => {
      utils.auth.listAccessGroups.invalidate();
      utils.auth.listStaffAccess.invalidate();
      setEditAccessGroup(null);
      ok("แก้ไขกลุ่มสิทธิ์แล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteAccessGroup = trpc.auth.deleteAccessGroup.useMutation({
    onSuccess: () => {
      utils.auth.listAccessGroups.invalidate();
      utils.auth.listStaffAccess.invalidate();
      ok("ลบกลุ่มสิทธิ์แล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteProduct = trpc.catalog.deleteProduct.useMutation({
    onSuccess: () => {
      utils.catalog.listProducts.invalidate();
      ok("ลบสินค้าแล้ว");
    },
    onError: e => fail(e.message),
  });
  const deleteReward = trpc.membership.deleteReward.useMutation({
    onSuccess: () => {
      utils.membership.listRewards.invalidate();
      ok("ลบของรางวัลแล้ว");
    },
    onError: e => fail(e.message),
  });
  const updateNozzle = trpc.catalog.updateNozzleMeter.useMutation({
    onSuccess: () => {
      utils.catalog.listPumps.invalidate();
      setEditN(null);
      ok("แก้ไขหัวจ่ายแล้ว");
    },
    onError: e => fail(e.message),
  });
  const saveReward = trpc.membership.upsertReward.useMutation({
    onSuccess: () => {
      utils.membership.listRewards.invalidate();
      setEditR(null);
      ok("บันทึกของรางวัลแล้ว");
    },
    onError: e => fail(e.message),
  });

  // ---------- ฐานข้อมูลบน Supabase ----------
  const {
    data: dbInfo,
    isFetching: dbInfoFetching,
    refetch: refetchDbInfo,
  } = trpc.dbadmin.dbInfo.useQuery(undefined, {
    enabled: isAdmin,
    refetchInterval: 60_000,
  });
  const backupNow = trpc.dbadmin.backup.useMutation({
    onSuccess: async result => {
      await refetchDbInfo();
      ok(`สำรองข้อมูลสำเร็จ: ${result.backup.fileName}`);
    },
    onError: e => fail(e.message),
  });
  const deleteBackup = trpc.dbadmin.deleteBackup.useMutation({
    onSuccess: async result => {
      setDeleteBackupTarget(null);
      setDeleteBackupConfirmation("");
      await refetchDbInfo();
      ok(
        result.backup.warning
          ? `ลบ ${result.backup.fileName} แล้ว — ${result.backup.warning}`
          : `ลบไฟล์สำรอง ${result.backup.fileName} แล้ว`
      );
    },
    onError: e => fail(e.message),
  });
  const downloadBackup = async (objectName: string) => {
    setDownloadingBackup(objectName);
    try {
      const result = await utils.dbadmin.readBackup.fetch({
        fileName: objectName,
      });
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.download = "";
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingBackup("");
    }
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // เลขถัดไปของเอกสาร: ส่งเฉพาะเมื่อแก้จากค่าที่โหลดมาจริงๆ
  // กันตัวนับถอยหลังกรณีมีการออกเอกสารระหว่างที่เปิดหน้านี้ค้างไว้
  const COUNTER_KEYS = ["receipt_next_no", "tax_invoice_next_no"];
  const saveAll = () => {
    const entries = Object.entries(form)
      .filter(
        ([k, v]) => !COUNTER_KEYS.includes(k) || v !== (settingMap?.[k] ?? "")
      )
      .map(([key, value]) => ({ key, value }));
    if (logoData !== null) entries.push({ key: "shop_logo", value: logoData });
    saveSettings.mutate({ entries });
  };

  const onLogoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) {
      fail("ไฟล์โลโก้ใหญ่เกิน 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // ย่อให้กว้างไม่เกิน 480px ก่อนเก็บเป็น base64 ลด payload
        const scale = Math.min(1, 480 / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas
          .getContext("2d")
          ?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setLogoData(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const nextPreview = (
    prefix: string | undefined,
    next: string | undefined,
    fallback: string
  ) =>
    `${prefix || fallback}${String(Math.max(1, Number(next ?? "1") || 1)).padStart(5, "0")}`;

  const logoShown = logoData !== null ? logoData : (shopLogo ?? "");

  // ระหว่างโหลด/โหลดพลาด อย่าแสดงฟอร์มค่า default — ผู้ใช้จะเข้าใจผิดว่าค่าที่ตั้งไว้หาย (เคยเกิดเหตุนี้จริง)
  if (settingsPending && !settingMap) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        กำลังโหลดการตั้งค่า…
      </div>
    );
  }
  if (settingsError && !settingMap) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-sm text-destructive">
          โหลดการตั้งค่าไม่สำเร็จ — เช็กว่าเซิร์ฟเวอร์ทำงานอยู่ แล้วลองใหม่
        </p>
        <Button variant="outline" onClick={() => refetchSettings()}>
          ลองใหม่
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="page-heading flex items-center gap-2">
        <SettingsIcon className="w-6 h-6 text-primary" /> ตั้งค่าระบบ
      </h1>
      {settingsError && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 flex flex-wrap items-center justify-between gap-2">
          <span>
            เชื่อมต่อฐานข้อมูลล่าสุดไม่สำเร็จ กำลังแสดงค่าที่โหลดไว้ก่อนหน้า:{" "}
            {settingsQueryError?.message}
          </span>
          <Button size="sm" variant="outline" onClick={() => refetchSettings()}>
            ลองใหม่
          </Button>
        </div>
      )}
      {msg && <p className="text-sm text-green-600">{msg}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {/* ข้อมูลร้าน */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Store className="w-4 h-4" /> ข้อมูลร้าน (แสดงบนใบเสร็จ/ใบกำกับภาษี)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>ชื่อร้าน</Label>
            <Input
              value={form.shop_name ?? ""}
              onChange={e => set("shop_name", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>สาขา</Label>
            <Input
              value={form.shop_branch ?? ""}
              onChange={e => set("shop_branch", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>ที่อยู่</Label>
            <Textarea
              rows={2}
              value={form.shop_address ?? ""}
              onChange={e => set("shop_address", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>เลขประจำตัวผู้เสียภาษี</Label>
            <Input
              value={form.tax_id ?? ""}
              onChange={e => set("tax_id", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>โทรศัพท์</Label>
            <Input
              value={form.shop_phone ?? ""}
              onChange={e => set("shop_phone", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>อัตรา VAT (%)</Label>
            <Input
              type="number"
              value={form.vat_rate ?? "7"}
              onChange={e => set("vat_rate", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>สะสมแต้ม (กี่บาท = 1 แต้ม)</Label>
            <Input
              type="number"
              value={form.point_earn_per_baht ?? "25"}
              onChange={e => set("point_earn_per_baht", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>มูลค่าแต้มตอนใช้ (1 แต้ม = กี่บาท)</Label>
            <Input
              type="number"
              value={form.point_redeem_value ?? "1"}
              onChange={e => set("point_redeem_value", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              disabled={!isAdmin || saveSettings.isPending}
              onClick={saveAll}
            >
              บันทึกการตั้งค่า {!isAdmin && "(เฉพาะแอดมิน)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* เลขที่เอกสาร & โลโก้ร้าน */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <FileText className="w-4 h-4" /> เลขที่เอกสาร & โลโก้ร้าน
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>คำนำหน้าเลขใบเสร็จอย่างย่อ</Label>
            <Input
              maxLength={10}
              value={form.receipt_prefix ?? "R"}
              onChange={e => set("receipt_prefix", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              เอกสารถัดไป:{" "}
              {nextPreview(form.receipt_prefix, form.receipt_next_no, "R")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>เลขถัดไปใบเสร็จอย่างย่อ</Label>
            <Input
              type="number"
              min={1}
              value={form.receipt_next_no ?? "1"}
              onChange={e => set("receipt_next_no", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>คำนำหน้าเลขใบกำกับภาษี</Label>
            <Input
              maxLength={10}
              value={form.tax_invoice_prefix ?? "T"}
              onChange={e => set("tax_invoice_prefix", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              เอกสารถัดไป:{" "}
              {nextPreview(
                form.tax_invoice_prefix,
                form.tax_invoice_next_no,
                "T"
              )}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>เลขถัดไปใบกำกับภาษี</Label>
            <Input
              type="number"
              min={1}
              value={form.tax_invoice_next_no ?? "1"}
              onChange={e => set("tax_invoice_next_no", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>โลโก้ร้าน (แสดงบนใบเสร็จ/ใบกำกับภาษี)</Label>
            <div className="flex items-center gap-3 flex-wrap">
              {logoShown ? (
                <img
                  src={logoShown}
                  alt="โลโก้ร้าน"
                  className="h-14 w-auto object-contain border rounded p-1 bg-white"
                />
              ) : (
                <div className="h-14 w-28 border border-dashed rounded flex items-center justify-center text-xs text-muted-foreground">
                  ยังไม่มีโลโก้
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isAdmin}
                  onClick={() => logoInputRef.current?.click()}
                >
                  <ImagePlus className="w-4 h-4 mr-1" /> เลือกรูป
                </Button>
                {logoShown && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!isAdmin}
                    onClick={() => setLogoData("")}
                  >
                    ลบโลโก้
                  </Button>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onLogoFile}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              รองรับไฟล์รูปไม่เกิน 2MB (ระบบย่อขนาดให้อัตโนมัติ) ·
              กดบันทึกเพื่อยืนยัน
            </p>
          </div>
          <div className="sm:col-span-2">
            <Button
              disabled={!isAdmin || saveSettings.isPending}
              onClick={saveAll}
            >
              บันทึกการตั้งค่า {!isAdmin && "(เฉพาะแอดมิน)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* การพิมพ์เอกสาร (ผ่านเบราว์เซอร์) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Printer className="w-4 h-4" /> การพิมพ์เอกสาร
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5 max-w-sm">
            <Label>ขนาดกระดาษใบเสร็จ (พิมพ์ผ่านเบราว์เซอร์)</Label>
            <Select
              value={form.receipt_paper_size ?? "80"}
              onValueChange={v => set("receipt_paper_size", v)}
              disabled={!isAdmin}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="80">ม้วนความร้อน 80 มม.</SelectItem>
                <SelectItem value="58">ม้วนความร้อน 58 มม.</SelectItem>
                <SelectItem value="a5">A5</SelectItem>
                <SelectItem value="a4">A4</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              ใช้กับปุ่ม &quot;พิมพ์&quot; ธรรมดาบนใบเสร็จ —
              ถ้าพิมพ์แล้วตัวอักษรใหญ่/ล้นขอบกระดาษ
              ให้เลือกขนาดตรงนี้ให้ตรงกระดาษจริง
            </p>
          </div>
          <div className="space-y-1.5 max-w-sm">
            <Label>ขนาดกระดาษใบกำกับภาษีเต็มรูป</Label>
            <Select
              value={form.tax_invoice_paper_size ?? "a4"}
              onValueChange={v => set("tax_invoice_paper_size", v)}
              disabled={!isAdmin}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a4">A4</SelectItem>
                <SelectItem value="a5">A5</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              ใช้กับใบเสร็จรับเงิน/ใบกำกับภาษีเต็มรูป
              ทั้งหน้าพรีวิวและหน้าต่างพิมพ์
            </p>
          </div>
          {isDesktop && (
            <div className="flex items-center justify-between rounded-md border p-3 max-w-sm">
              <div className="pr-3">
                <Label
                  htmlFor="receipt_silent_print"
                  className="cursor-pointer"
                >
                  พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  พิมพ์เงียบเข้าเครื่องพิมพ์ default ของ Windows ทันทีโดยไม่เด้ง
                  dialog (เฉพาะ desktop app — ต้องตั้งเครื่องพิมพ์ที่ใช้เป็น
                  default ไว้ก่อน)
                </p>
              </div>
              <Switch
                id="receipt_silent_print"
                disabled={!isAdmin}
                checked={form.receipt_silent_print === "1"}
                onCheckedChange={v =>
                  set("receipt_silent_print", v ? "1" : "0")
                }
              />
            </div>
          )}
          <div>
            <Button
              disabled={!isAdmin || saveSettings.isPending}
              onClick={saveAll}
            >
              <Save className="w-4 h-4 mr-2" /> บันทึกการตั้งค่า{" "}
              {!isAdmin && "(เฉพาะแอดมิน)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* เครือข่าย LAN (ขายหลายเครื่องพร้อมกัน) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Network className="w-4 h-4" /> เครือข่าย LAN
            (ขายหลายเครื่องพร้อมกัน)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-3 max-w-xl">
            <Label htmlFor="lan_enabled" className="cursor-pointer">
              เปิดให้เครื่องอื่นใน LAN เชื่อมต่อ
            </Label>
            <Switch
              id="lan_enabled"
              disabled={!isAdmin}
              checked={form.lan_enabled === "1"}
              onCheckedChange={v => set("lan_enabled", v ? "1" : "0")}
            />
          </div>
          {form.lan_enabled === "1" && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-amber-600">
                มีผลหลังกดบันทึกแล้วรีสตาร์ทแอป (Docker: restart container)
              </p>
              {lanInfo && lanInfo.urls.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    เครื่องลูกเปิดเบราว์เซอร์ไปที่:
                  </p>
                  {lanInfo.urls.map(u => (
                    <div key={u} className="flex items-center gap-2">
                      <code className="rounded bg-muted px-2 py-1 text-xs">
                        {u}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          void navigator.clipboard?.writeText(u);
                          ok("คัดลอก URL แล้ว");
                        }}
                      >
                        <Copy className="w-3 h-3 mr-1" /> คัดลอก
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  ไม่พบ IP ของเครื่องนี้ในเครือข่าย — ตรวจสอบการเชื่อมต่อ LAN
                </p>
              )}
              <ul className="list-disc pl-5 space-y-1 text-xs text-muted-foreground">
                <li>
                  เครื่องลูกล็อกอินด้วย PIN ของพนักงานแต่ละคน และขายภายใต้
                  <span className="font-medium text-foreground">
                    กะรวมกะเดียวกัน
                  </span>{" "}
                  (เปิด/ปิดกะจากเครื่องใดเครื่องหนึ่ง)
                </li>
                <li>
                  ใบเสร็จพิมพ์ผ่านเบราว์เซอร์ของแต่ละเครื่อง
                  (เลือกเครื่องพิมพ์ของเครื่องนั้นตอนกดพิมพ์)
                </li>
                <li>
                  ครั้งแรก Windows อาจถามอนุญาต Firewall ให้กด Allow —
                  ถ้าเชื่อมไม่ได้ให้รัน CMD แบบ Administrator:{" "}
                  <code className="rounded bg-muted px-1">
                    netsh advfirewall firewall add rule name=&quot;POS
                    Pump&quot; dir=in action=allow protocol=TCP localport=
                    {lanInfo?.port ?? 3210}
                  </code>
                </li>
                <li>
                  ใช้เฉพาะใน LAN ที่เชื่อถือได้เท่านั้น — เครื่องใน LAN
                  ทุกเครื่องเข้าถึงระบบได้ผ่านหน้าล็อกอิน
                </li>
              </ul>
            </div>
          )}
          <div>
            <Button
              disabled={!isAdmin || saveSettings.isPending}
              onClick={saveAll}
            >
              <Save className="w-4 h-4 mr-2" /> บันทึกการตั้งค่า{" "}
              {!isAdmin && "(เฉพาะแอดมิน)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* สินค้าและราคา */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Fuel className="w-4 h-4" /> สินค้า & ราคา
          </CardTitle>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditP({ ...emptyProduct })}
            >
              <Plus className="w-4 h-4 mr-1" /> เพิ่มสินค้า
            </Button>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>รหัส</TableHead>
                <TableHead>สินค้า</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead className="text-right">ทุน</TableHead>
                <TableHead className="text-right">ราคาขาย</TableHead>
                <TableHead className="text-right">สต๊อก</TableHead>
                <TableHead>สถานะ</TableHead>
                {isAdmin && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(products ?? []).map(p => (
                <TableRow key={p.id} className={!p.active ? "opacity-50" : ""}>
                  <TableCell className="font-mono text-xs">{p.code}</TableCell>
                  <TableCell>
                    {p.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({p.unit})
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {categoryLabel[p.category]}
                  </TableCell>
                  <TableCell className="text-right">
                    ฿{fmtMoney(p.cost)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-primary">
                    ฿{fmtMoney(p.price)}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.category === "fuel" ? "-" : `${fmtNum(p.stockQty)}`}
                  </TableCell>
                  <TableCell>
                    {p.active ? (
                      <Badge variant="secondary">ขายอยู่</Badge>
                    ) : (
                      <Badge variant="destructive">ปิดขาย</Badge>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="ประวัติเปลี่ยนราคา"
                          onClick={() => setHistP(p)}
                        >
                          <History className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="แก้ไข"
                          onClick={() => setEditP(p)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          disabled={deleteProduct.isPending}
                          onClick={() => {
                            if (
                              confirm(
                                `ยืนยันลบสินค้า "${p.name}"? (ประวัติขายเก่ายังคงอยู่)`
                              )
                            ) {
                              deleteProduct.mutate({ id: p.id });
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="border-violet-200/70 bg-gradient-to-br from-white to-violet-50/40">
          <CardHeader className="pb-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-heading flex items-center gap-2 text-base">
                <UsersRound className="size-4 text-violet-600" />{" "}
                กลุ่มสิทธิ์ผู้ใช้
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                กำหนดเมนูครั้งเดียว แล้วนำพนักงานหลายคนเข้าใช้กลุ่มเดียวกัน
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setEditAccessGroup({
                  name: "",
                  description: "",
                  role: "cashier",
                  menuPermissions: getRoleMenuPermissions("cashier"),
                })
              }
            >
              <Plus className="mr-1 size-4" /> เพิ่มกลุ่ม
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(accessGroups ?? []).map(group => (
                <div
                  key={group.id}
                  className="rounded-2xl border bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {group.name}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {group.description || "ไม่มีรายละเอียด"}
                      </div>
                    </div>
                    <Badge variant="secondary">
                      {roleLabel[group.role] ?? group.role}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-700">
                      {group.menuPermissions.length} เมนู
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                      {group.memberCount} คน
                    </span>
                  </div>
                  <div className="mt-3 flex justify-end gap-1 border-t pt-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() =>
                        setEditAccessGroup({
                          id: group.id,
                          name: group.name,
                          description: group.description,
                          role: group.role,
                          menuPermissions: [...group.menuPermissions],
                        })
                      }
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive"
                      disabled={deleteAccessGroup.isPending}
                      onClick={() => {
                        if (
                          confirm(
                            `ยืนยันลบกลุ่ม "${group.name}"? สมาชิก ${group.memberCount} คนจะกลับไปใช้สิทธิ์รายบุคคล`
                          )
                        ) {
                          deleteAccessGroup.mutate({ id: group.id });
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader className="flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="flex items-center gap-2 font-heading text-base">
                <Store className="size-4" /> สาขา
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                สินค้า สต็อก ยอดขาย กะ เอกสาร และการตั้งค่าจะแยกจากกันตามสาขา
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowBranch(true)}>
              <Plus className="mr-1 size-4" /> เพิ่มสาขา
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(allBranches ?? []).map(branch => (
              <div
                key={branch.id}
                className="rounded-xl border bg-white px-4 py-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={branch.active ? "default" : "secondary"}>
                        {branch.code}
                      </Badge>
                      {branch.id === staff?.branch.id && (
                        <span className="text-xs font-medium text-violet-600">
                          กำลังใช้งาน
                        </span>
                      )}
                    </div>
                    <div className="mt-2 truncate font-medium">{branch.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {branch.address || "ยังไม่ได้ระบุที่อยู่"}
                    </div>
                  </div>
                  <Switch
                    checked={branch.active}
                    disabled={
                      updateBranch.isPending ||
                      (branch.active && branch.id === staff?.branch.id)
                    }
                    onCheckedChange={active =>
                      updateBranch.mutate({ id: branch.id, active })
                    }
                    aria-label={`สถานะสาขา ${branch.name}`}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* พนักงาน */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <UserCog className="w-4 h-4" /> พนักงาน
            </CardTitle>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowStaff(true)}
              >
                <Plus className="w-4 h-4 mr-1" /> เพิ่ม
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {(staffList ?? []).map(s => (
              <div
                key={s.id}
                className="flex items-center justify-between border rounded-lg px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">
                    {s.name}{" "}
                    {!s.active && (
                      <span className="text-xs text-destructive">
                        (ปิดใช้งาน)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    @{s.username}
                  </div>
                  {isAdmin && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-violet-600">
                      <span>
                        ใช้งานได้{" "}
                        {
                          staffMenuPermissions(
                            s.role,
                            "menuPermissions" in s
                              ? s.menuPermissions
                              : undefined
                          ).length
                        }{" "}
                        เมนู
                      </span>
                      <StaffGroupBadge
                        groupId={
                          "accessGroupId" in s ? s.accessGroupId : undefined
                        }
                        groups={accessGroups ?? []}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant={s.role === "admin" ? "default" : "secondary"}>
                    {roleLabel[s.role] ?? s.role}
                  </Badge>
                  {isAdmin && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditS({
                            id: s.id,
                            username: s.username,
                            name: s.name,
                            role: s.role,
                            accessGroupId:
                              "accessGroupId" in s &&
                              typeof s.accessGroupId === "number"
                                ? s.accessGroupId
                                : null,
                            pin: "",
                            menuPermissions: staffMenuPermissions(
                              s.role,
                              "menuPermissions" in s
                                ? s.menuPermissions
                                : undefined
                            ),
                            branchIds:
                              "branchIds" in s && Array.isArray(s.branchIds)
                                ? s.branchIds
                                : [],
                          });
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        disabled={deleteStaff.isPending}
                        onClick={() => {
                          if (confirm(`ยืนยันลบพนักงาน "${s.name}"?`))
                            deleteStaff.mutate({ id: s.id });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ของรางวัล */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <Gift className="w-4 h-4" /> ของรางวัล
            </CardTitle>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setEditR({ name: "", pointsRequired: 100, stock: 10 })
                }
              >
                <Plus className="w-4 h-4 mr-1" /> เพิ่ม
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {(rewards ?? []).map(r => (
              <div
                key={r.id}
                className="flex items-center justify-between border rounded-lg px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.pointsRequired} แต้ม · คงเหลือ {r.stock}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() =>
                        setEditR({
                          id: r.id,
                          name: r.name,
                          pointsRequired: r.pointsRequired,
                          stock: r.stock,
                        })
                      }
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      disabled={deleteReward.isPending}
                      onClick={() => {
                        if (confirm(`ยืนยันลบของรางวัล "${r.name}"?`))
                          deleteReward.mutate({ id: r.id });
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ตู้จ่าย / หัวจ่าย (admin) */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <Gauge className="w-4 h-4" /> ตู้จ่าย & หัวจ่าย —
              ตั้งค่าถังตัดสต๊อก/ชื่อ/มิเตอร์ (admin)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(pumps ?? []).map(p => (
              <div key={p.id}>
                <div className="text-sm font-semibold mb-1.5">{p.name}</div>
                <div className="space-y-1.5">
                  {p.nozzles.map(n => (
                    <div
                      key={n.id}
                      className="flex flex-wrap items-center justify-between gap-2 border rounded-lg px-3 py-2"
                    >
                      <div>
                        <div className="text-sm font-medium">{n.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {n.product?.name} · ถัง:{" "}
                          {n.tank?.name ?? "ยังไม่ผูกถัง"}
                          {" · "}P: ฿{fmtNum(n.currentMoney)} · L:{" "}
                          {fmtNum(n.currentMeter)}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setEditN({
                            id: n.id,
                            label: n.label,
                            productId: n.productId,
                            tankId: n.tankId,
                            meter: n.currentMeter,
                            money: n.currentMoney,
                          })
                        }
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" /> แก้ไข
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ฐานข้อมูลและ Backup (admin) */}
      {isAdmin && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <Database className="w-4 h-4" /> ฐานข้อมูลและการสำรองข้อมูล
              (admin)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />{" "}
                    Supabase Backup
                  </div>
                  <Badge variant="secondary">
                    แผน {dbInfo?.supabasePlan ?? "Pro"}
                  </Badge>
                </div>
                <p className="text-sm">สำรองอัตโนมัติรายวันโดย Supabase</p>
                <p className="text-xs text-muted-foreground">
                  กู้คืนย้อนหลังได้ {dbInfo?.supabaseDailyRetentionDays ?? 7}{" "}
                  วัน
                </p>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    <Cloud className="h-4 w-4 text-sky-600" /> Private GCS
                  </div>
                  <Badge
                    variant={
                      dbInfo?.offsiteConfigured ? "default" : "destructive"
                    }
                  >
                    {dbInfo?.offsiteConfigured
                      ? "พร้อมใช้งาน"
                      : "ยังไม่ตั้งค่า"}
                  </Badge>
                </div>
                <p className="text-sm">
                  สำรอง Logical Backup{" "}
                  {dbInfo?.offsiteSchedule ?? "ทุก 6 ชั่วโมง"}
                </p>
                <p className="break-all text-xs text-muted-foreground">
                  {dbInfo?.offsiteBucket || "Private bucket กำลังรอการตั้งค่า"}
                </p>
                <p className="text-xs text-muted-foreground">
                  เก็บชุดปกติ {dbInfo?.offsiteDailyRetentionDays ?? 35} วัน ·
                  รายเดือน {dbInfo?.offsiteMonthlyRetentionDays ?? 370} วัน
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => backupNow.mutate()}
                disabled={!dbInfo?.offsiteConfigured || backupNow.isPending}
              >
                <Database className="mr-1.5 h-4 w-4" />
                {backupNow.isPending
                  ? "กำลังสำรองข้อมูล..."
                  : "สำรองข้อมูลตอนนี้"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void refetchDbInfo()}
                disabled={dbInfoFetching}
              >
                <RefreshCw
                  className={`mr-1.5 h-4 w-4 ${dbInfoFetching ? "animate-spin" : ""}`}
                />
                ตรวจสอบสถานะ
              </Button>
              <Button asChild type="button" variant="outline">
                <a
                  href={
                    dbInfo?.supabaseDashboardUrl ??
                    "https://supabase.com/dashboard"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  เปิด Supabase Backups
                </a>
              </Button>
            </div>

            {dbInfo?.backupListError && (
              <p className="text-sm text-destructive">
                {dbInfo.backupListError}
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">ไฟล์สำรองนอกระบบล่าสุด</p>
                <span className="text-xs text-muted-foreground">
                  ลิงก์ดาวน์โหลดมีอายุ 15 นาที
                </span>
              </div>
              {dbInfo?.backups.length ? (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>วันที่สำรอง</TableHead>
                        <TableHead>ประเภท</TableHead>
                        <TableHead>ขนาด</TableHead>
                        <TableHead>SHA-256</TableHead>
                        <TableHead className="text-right">จัดการ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dbInfo.backups.slice(0, 12).map(backup => (
                        <TableRow key={backup.objectName}>
                          <TableCell className="whitespace-nowrap text-sm">
                            {fmtDateTime(backup.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {backupTriggerLabel(backup.trigger)}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {fmtFileSize(backup.sizeBytes)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {backup.sha256
                              ? `${backup.sha256.slice(0, 12)}…`
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void downloadBackup(backup.objectName)
                                }
                                disabled={
                                  downloadingBackup === backup.objectName
                                }
                              >
                                <Download className="mr-1 h-3.5 w-3.5" />
                                {downloadingBackup === backup.objectName
                                  ? "กำลังเตรียม..."
                                  : "ดาวน์โหลด"}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setRestoreBackupTarget(backup)}
                              >
                                <History className="mr-1 h-3.5 w-3.5" />
                                Restore
                              </Button>
                              {backup.trigger === "manual" ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="text-destructive hover:text-destructive"
                                  title={
                                    dbInfo.offsiteDeleteEnabled
                                      ? "ลบ Manual Backup"
                                      : "Railway ยังไม่ได้เปิด GCS_BACKUP_DELETE_ENABLED"
                                  }
                                  disabled={!dbInfo.offsiteDeleteEnabled}
                                  onClick={() => {
                                    setDeleteBackupTarget(backup);
                                    setDeleteBackupConfirmation("");
                                  }}
                                >
                                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                                  ลบ
                                </Button>
                              ) : (
                                <span className="self-center whitespace-nowrap px-1 text-xs text-muted-foreground">
                                  ลบตาม Lifecycle
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  ยังไม่มีไฟล์สำรองนอกระบบ เมื่อระบบพร้อมให้กด
                  “สำรองข้อมูลตอนนี้”
                </div>
              )}
            </div>

            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-xs">
                {dbInfo?.managedRestoreMessage ??
                  "การกู้คืนต้องทำลงฐานทดสอบก่อนตรวจสอบและสลับการเชื่อมต่อ ห้ามกู้ทับฐาน production โดยตรง"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Restore ทำได้ผ่านฐานทดสอบเท่านั้น */}
      <Dialog
        open={!!restoreBackupTarget}
        onOpenChange={open => !open && setRestoreBackupTarget(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Restore ลง Supabase โปรเจกต์ทดสอบ
            </DialogTitle>
          </DialogHeader>
          {restoreBackupTarget && (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                ระบบจะไม่กู้ไฟล์นี้ทับ production โดยตรง
                ต้องตรวจข้อมูลบนโปรเจกต์ทดสอบก่อนทุกครั้ง
              </div>
              <div className="space-y-1 rounded-lg border p-3">
                <p className="font-medium">ไฟล์ที่เลือก</p>
                <p className="break-all font-mono text-xs">
                  {restoreBackupTarget.fileName}
                </p>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  SHA-256: {restoreBackupTarget.sha256 || "ไม่ระบุ"}
                </p>
              </div>
              <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                <li>ดาวน์โหลดไฟล์และตรวจ SHA-256 ให้ตรงกับรายการ</li>
                <li>
                  สร้าง Supabase โปรเจกต์ทดสอบ หรือใช้ Restore-to-New-Project
                  จาก Supabase Backup
                </li>
                <li>
                  กู้ไฟล์นี้ด้วย <code>pg_restore</code> ไปยัง Session pooler
                  ของโปรเจกต์ทดสอบเท่านั้น
                </li>
                <li>
                  ทดสอบ Login, Dashboard, เปิดกะ, การขาย และรายงาน
                  ก่อนวางแผนสลับ DATABASE_URL
                </li>
              </ol>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  restoreBackupTarget &&
                  void downloadBackup(restoreBackupTarget.objectName)
                }
                disabled={
                  !restoreBackupTarget ||
                  downloadingBackup === restoreBackupTarget.objectName
                }
              >
                <Download className="mr-1.5 h-4 w-4" /> ดาวน์โหลดไฟล์นี้
              </Button>
              <Button asChild type="button" variant="outline">
                <a
                  href={
                    dbInfo?.supabaseRestoreToNewProjectUrl ??
                    "https://supabase.com/dashboard"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  เปิด Restore-to-New-Project
                </a>
              </Button>
            </div>
            <Button type="button" onClick={() => setRestoreBackupTarget(null)}>
              ปิด
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete เปิดเฉพาะ Manual Backup และต้องพิมพ์ชื่อไฟล์ยืนยัน */}
      <Dialog
        open={!!deleteBackupTarget}
        onOpenChange={open => {
          if (!open && !deleteBackup.isPending) {
            setDeleteBackupTarget(null);
            setDeleteBackupConfirmation("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading text-destructive">
              ยืนยันลบ Manual Backup
            </DialogTitle>
          </DialogHeader>
          {deleteBackupTarget && (
            <div className="space-y-4 text-sm">
              <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p>
                  ระบบจะลบทั้งไฟล์ dump และ manifest จาก Private GCS
                  โดยไฟล์ยังอยู่ใน GCS Soft Delete ตามระยะเวลาที่ bucket กำหนด
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="backup-delete-confirmation">
                  พิมพ์ชื่อไฟล์ต่อไปนี้เพื่อยืนยัน
                </Label>
                <p className="break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
                  {deleteBackupTarget.fileName}
                </p>
                <Input
                  id="backup-delete-confirmation"
                  autoComplete="off"
                  value={deleteBackupConfirmation}
                  onChange={event =>
                    setDeleteBackupConfirmation(event.target.value)
                  }
                  placeholder={deleteBackupTarget.fileName}
                  disabled={deleteBackup.isPending}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleteBackup.isPending}
              onClick={() => {
                setDeleteBackupTarget(null);
                setDeleteBackupConfirmation("");
              }}
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                !deleteBackupTarget ||
                deleteBackup.isPending ||
                deleteBackupConfirmation !== deleteBackupTarget.fileName
              }
              onClick={() => {
                if (!deleteBackupTarget) return;
                deleteBackup.mutate({
                  fileName: deleteBackupTarget.objectName,
                  confirmation: deleteBackupConfirmation,
                });
              }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {deleteBackup.isPending ? "กำลังลบ..." : "ลบไฟล์สำรอง"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog สินค้า */}
      <Dialog open={!!editP} onOpenChange={o => !o && setEditP(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editP?.id ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}
            </DialogTitle>
          </DialogHeader>
          {editP && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>รหัสสินค้า</Label>
                <Input
                  value={editP.code}
                  disabled={!!editP.id}
                  onChange={e => setEditP({ ...editP, code: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ชื่อสินค้า</Label>
                <Input
                  value={editP.name}
                  onChange={e => setEditP({ ...editP, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>หมวด</Label>
                <Select
                  value={editP.category}
                  onValueChange={v =>
                    setEditP({ ...editP, category: v as typeof editP.category })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fuel">น้ำมัน</SelectItem>
                    <SelectItem value="lubricant">2T/น้ำมันเครื่อง</SelectItem>
                    <SelectItem value="other">สินค้าอื่นๆ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>หน่วย</Label>
                <Input
                  value={editP.unit}
                  onChange={e => setEditP({ ...editP, unit: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ราคาขาย</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editP.price || ""}
                  onChange={e =>
                    setEditP({ ...editP, price: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>ต้นทุน</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editP.cost || ""}
                  onChange={e =>
                    setEditP({ ...editP, cost: Number(e.target.value) || 0 })
                  }
                />
              </div>
              {editP.category !== "fuel" && (
                <>
                  <div className="space-y-1.5">
                    <Label>สต๊อก</Label>
                    <Input
                      type="number"
                      value={editP.stockQty || ""}
                      onChange={e =>
                        setEditP({
                          ...editP,
                          stockQty: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>แจ้งเตือนเมื่อต่ำกว่า</Label>
                    <Input
                      type="number"
                      value={editP.lowStockAt || ""}
                      onChange={e =>
                        setEditP({
                          ...editP,
                          lowStockAt: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </>
              )}
              {editP.id && (
                <div className="col-span-2 flex items-center gap-2">
                  <Label>สถานะ:</Label>
                  <Button
                    size="sm"
                    variant={editP.active ? "outline" : "default"}
                    onClick={() =>
                      setEditP({ ...editP, active: !editP.active })
                    }
                  >
                    {editP.active ? "ปิดการขาย" : "เปิดการขาย"}
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={
                !editP?.name ||
                !editP?.code ||
                saveProduct.isPending ||
                createProduct.isPending
              }
              onClick={() => {
                if (!editP) return;
                if (editP.id) {
                  saveProduct.mutate({
                    id: editP.id,
                    code: editP.code,
                    name: editP.name,
                    category: editP.category,
                    unit: editP.unit,
                    price: editP.price,
                    cost: editP.cost,
                    stockQty: editP.stockQty,
                    lowStockAt: editP.lowStockAt,
                    active: editP.active,
                  });
                } else {
                  createProduct.mutate({
                    code: editP.code,
                    name: editP.name,
                    category: editP.category,
                    unit: editP.unit,
                    price: editP.price,
                    cost: editP.cost,
                    stockQty: editP.stockQty,
                    lowStockAt: editP.lowStockAt,
                  });
                }
              }}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog ประวัติเปลี่ยนราคา */}
      <Dialog open={!!histP} onOpenChange={o => !o && setHistP(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">
              ประวัติเปลี่ยนราคา — {histP?.name}
            </DialogTitle>
          </DialogHeader>
          {(priceHist ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              ยังไม่มีการเปลี่ยนราคา
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่เวลา</TableHead>
                    <TableHead className="text-right">ราคาเดิม</TableHead>
                    <TableHead className="text-right">ราคาใหม่</TableHead>
                    <TableHead>ผู้เปลี่ยน</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(priceHist ?? []).map(h => (
                    <TableRow key={h.id}>
                      <TableCell className="text-sm">
                        {fmtDateTime(h.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        ฿{fmtMoney(h.oldPrice)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-primary">
                        ฿{fmtMoney(h.newPrice)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {h.changedBy || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog กลุ่มสิทธิ์ */}
      <Dialog
        open={!!editAccessGroup}
        onOpenChange={open => !open && setEditAccessGroup(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editAccessGroup?.id ? "แก้ไขกลุ่มสิทธิ์" : "เพิ่มกลุ่มสิทธิ์"}
            </DialogTitle>
            <DialogDescription>
              สมาชิกทุกคนในกลุ่มจะเห็นและเข้าใช้งานเฉพาะเมนูที่เปิดไว้
            </DialogDescription>
          </DialogHeader>
          {editAccessGroup && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>ชื่อกลุ่ม</Label>
                  <Input
                    value={editAccessGroup.name}
                    onChange={event =>
                      setEditAccessGroup({
                        ...editAccessGroup,
                        name: event.target.value,
                      })
                    }
                    placeholder="เช่น พนักงานหน้าลาน"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>ระดับผู้ใช้ของกลุ่ม</Label>
                  <Select
                    value={editAccessGroup.role}
                    disabled={Boolean(editAccessGroup.id)}
                    onValueChange={value =>
                      setEditAccessGroup({
                        ...editAccessGroup,
                        role: value as "manager" | "cashier",
                        menuPermissions: getRoleMenuPermissions(
                          value as "manager" | "cashier"
                        ),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cashier">พนักงานขาย</SelectItem>
                      <SelectItem value="manager">ผู้จัดการสาขา</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>รายละเอียด</Label>
                <Input
                  value={editAccessGroup.description}
                  onChange={event =>
                    setEditAccessGroup({
                      ...editAccessGroup,
                      description: event.target.value,
                    })
                  }
                  placeholder="อธิบายหน้าที่หรือขอบเขตของกลุ่ม"
                />
              </div>
              <MenuPermissionEditor
                role={editAccessGroup.role}
                value={editAccessGroup.menuPermissions}
                onChange={menuPermissions =>
                  setEditAccessGroup({ ...editAccessGroup, menuPermissions })
                }
              />
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={
                !editAccessGroup?.name.trim() ||
                editAccessGroup.menuPermissions.length === 0 ||
                createAccessGroup.isPending ||
                updateAccessGroup.isPending
              }
              onClick={() => {
                if (!editAccessGroup) return;
                if (editAccessGroup.id) {
                  updateAccessGroup.mutate({
                    id: editAccessGroup.id,
                    name: editAccessGroup.name,
                    description: editAccessGroup.description,
                    menuPermissions: editAccessGroup.menuPermissions,
                  });
                } else {
                  createAccessGroup.mutate({
                    name: editAccessGroup.name,
                    description: editAccessGroup.description,
                    role: editAccessGroup.role,
                    menuPermissions: editAccessGroup.menuPermissions,
                  });
                }
              }}
            >
              {editAccessGroup?.id ? "บันทึกกลุ่มสิทธิ์" : "เพิ่มกลุ่มสิทธิ์"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog พนักงาน */}
      <Dialog open={showBranch} onOpenChange={setShowBranch}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">เพิ่มสาขา</DialogTitle>
            <DialogDescription>
              ระบบจะสร้างพื้นที่ข้อมูลแยก และเริ่มเลขเอกสารของสาขาใหม่จาก 1
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>รหัสสาขา</Label>
              <Input
                value={newBranch.code}
                onChange={event =>
                  setNewBranch({
                    ...newBranch,
                    code: event.target.value.toUpperCase(),
                  })
                }
                placeholder="เช่น BKK01"
              />
            </div>
            <div className="space-y-1.5">
              <Label>ชื่อสาขา</Label>
              <Input
                value={newBranch.name}
                onChange={event =>
                  setNewBranch({ ...newBranch, name: event.target.value })
                }
                placeholder="เช่น สาขากรุงเทพ"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>ที่อยู่</Label>
              <Textarea
                value={newBranch.address}
                onChange={event =>
                  setNewBranch({ ...newBranch, address: event.target.value })
                }
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label>โทรศัพท์</Label>
              <Input
                value={newBranch.phone}
                onChange={event =>
                  setNewBranch({ ...newBranch, phone: event.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>เลขประจำตัวผู้เสียภาษี</Label>
              <Input
                value={newBranch.taxId}
                onChange={event =>
                  setNewBranch({ ...newBranch, taxId: event.target.value })
                }
              />
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 p-3 sm:col-span-2">
              <div>
                <div className="text-sm font-medium">
                  คัดลอกโครงสร้างจากสาขาปัจจุบัน
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  คัดลอกสินค้า หัวจ่าย ถัง รางวัล และกะงาน แต่เริ่มสต็อก/มิเตอร์ที่ศูนย์
                </div>
              </div>
              <Switch
                checked={newBranch.cloneCurrentSetup}
                onCheckedChange={cloneCurrentSetup =>
                  setNewBranch({ ...newBranch, cloneCurrentSetup })
                }
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              className="w-full"
              disabled={
                newBranch.code.trim().length < 2 ||
                !newBranch.name.trim() ||
                createBranch.isPending
              }
              onClick={() => createBranch.mutate(newBranch)}
            >
              {createBranch.isPending ? "กำลังสร้างสาขา..." : "สร้างสาขา"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showStaff} onOpenChange={setShowStaff}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">เพิ่มพนักงาน</DialogTitle>
            <DialogDescription>
              กรอกข้อมูลบัญชีและเลือกเมนูที่พนักงานคนนี้สามารถใช้งานได้
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>ชื่อ-นามสกุล</Label>
              <Input
                value={newStaff.name}
                onChange={e =>
                  setNewStaff({ ...newStaff, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>ชื่อผู้ใช้</Label>
              <Input
                value={newStaff.username}
                onChange={e =>
                  setNewStaff({ ...newStaff, username: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>รหัส PIN (อย่างน้อย 4 หลัก)</Label>
              <Input
                type="password"
                value={newStaff.pin}
                onChange={e =>
                  setNewStaff({ ...newStaff, pin: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>สิทธิ์</Label>
              <Select
                value={newStaff.role}
                onValueChange={v =>
                  setNewStaff({
                    ...newStaff,
                    role: v as "admin" | "manager" | "cashier",
                    accessGroupId: null,
                    menuPermissions: getRoleMenuPermissions(v as StaffRole),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cashier">พนักงานขาย</SelectItem>
                  <SelectItem value="manager">ผู้จัดการสาขา</SelectItem>
                  <SelectItem value="admin">ผู้ดูแลระบบ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <StaffBranchSelector
              branches={(allBranches ?? []).filter(branch => branch.active)}
              value={newStaff.branchIds}
              onChange={branchIds =>
                setNewStaff({ ...newStaff, branchIds })
              }
            />
            <StaffAccessSelector
              role={newStaff.role}
              accessGroupId={newStaff.accessGroupId}
              menuPermissions={newStaff.menuPermissions}
              groups={accessGroups ?? []}
              onGroupChange={accessGroupId =>
                setNewStaff({ ...newStaff, accessGroupId })
              }
              onPermissionsChange={menuPermissions =>
                setNewStaff({ ...newStaff, menuPermissions })
              }
            />
          </div>
          <DialogFooter>
            <Button
              className="w-full"
              disabled={
                !newStaff.name ||
                newStaff.username.length < 3 ||
                newStaff.pin.length < 4 ||
                newStaff.branchIds.length === 0 ||
                (newStaff.role !== "admin" &&
                  newStaff.accessGroupId === null &&
                  newStaff.menuPermissions.length === 0) ||
                createStaff.isPending
              }
              onClick={() => createStaff.mutate(newStaff)}
            >
              เพิ่มพนักงาน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขพนักงาน */}
      <Dialog open={!!editS} onOpenChange={o => !o && setEditS(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">แก้ไขพนักงาน</DialogTitle>
            <DialogDescription>
              แก้ไขข้อมูลบัญชีและกำหนดสิทธิ์เมนูสำหรับพนักงานคนนี้
            </DialogDescription>
          </DialogHeader>
          {editS && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อ-นามสกุล</Label>
                <Input
                  value={editS.name}
                  onChange={e => setEditS({ ...editS, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ชื่อผู้ใช้</Label>
                <Input
                  value={editS.username}
                  onChange={e =>
                    setEditS({ ...editS, username: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>รหัส PIN ใหม่ (เว้นว่างถ้าไม่เปลี่ยน)</Label>
                <Input
                  type="password"
                  value={editS.pin}
                  onChange={e => setEditS({ ...editS, pin: e.target.value })}
                  placeholder="••••"
                />
              </div>
              <div className="space-y-1.5">
                <Label>สิทธิ์</Label>
                <Select
                  value={editS.role}
                  onValueChange={v =>
                    setEditS({
                      ...editS,
                      role: v as "admin" | "manager" | "cashier",
                      accessGroupId: null,
                      menuPermissions: getRoleMenuPermissions(v as StaffRole),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cashier">พนักงานขาย</SelectItem>
                    <SelectItem value="manager">ผู้จัดการสาขา</SelectItem>
                    <SelectItem value="admin">ผู้ดูแลระบบ</SelectItem>
                  </SelectContent>
              </Select>
            </div>
              <StaffBranchSelector
                branches={(allBranches ?? []).filter(branch => branch.active)}
                value={editS.branchIds}
                onChange={branchIds => setEditS({ ...editS, branchIds })}
              />
              <StaffAccessSelector
                role={editS.role}
                accessGroupId={editS.accessGroupId}
                menuPermissions={editS.menuPermissions}
                groups={accessGroups ?? []}
                onGroupChange={accessGroupId =>
                  setEditS({ ...editS, accessGroupId })
                }
                onPermissionsChange={menuPermissions =>
                  setEditS({ ...editS, menuPermissions })
                }
              />
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={
                !editS?.name ||
                editS.branchIds.length === 0 ||
                (editS.role !== "admin" &&
                  editS.accessGroupId === null &&
                  editS.menuPermissions.length === 0) ||
                updateStaff.isPending
              }
              onClick={() =>
                editS &&
                updateStaff.mutate({
                  id: editS.id,
                  name: editS.name,
                  username: editS.username,
                  role: editS.role,
                  accessGroupId: editS.accessGroupId,
                  menuPermissions: editS.menuPermissions,
                  branchIds: editS.branchIds,
                  ...(editS.pin ? { pin: editS.pin } : {}),
                })
              }
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขหัวจ่าย */}
      <Dialog open={!!editN} onOpenChange={o => !o && setEditN(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">แก้ไขหัวจ่าย</DialogTitle>
          </DialogHeader>
          {editN && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อหัวจ่าย</Label>
                <Input
                  value={editN.label}
                  onChange={e => setEditN({ ...editN, label: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ชนิดน้ำมันที่จ่าย</Label>
                <Select
                  value={String(editN.productId)}
                  onValueChange={v => {
                    const productId = Number(v);
                    const firstTank = (tanks ?? []).find(
                      tank => tank.productId === productId
                    );
                    setEditN({
                      ...editN,
                      productId,
                      tankId: firstTank?.id ?? null,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(products ?? [])
                      .filter(p => p.category === "fuel" && p.active)
                      .map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} ({p.code})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>ถังน้ำมันที่ตัดสต๊อก</Label>
                <Select
                  value={
                    editN.tankId != null ? String(editN.tankId) : undefined
                  }
                  onValueChange={v => setEditN({ ...editN, tankId: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="เลือกถังน้ำมัน" />
                  </SelectTrigger>
                  <SelectContent>
                    {(tanks ?? [])
                      .filter(tank => tank.productId === editN.productId)
                      .map(tank => (
                        <SelectItem key={tank.id} value={String(tank.id)}>
                          {tank.name} (คงเหลือ {fmtNum(tank.currentLiters)}{" "}
                          ลิตร)
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {(tanks ?? []).filter(
                  tank => tank.productId === editN.productId
                ).length === 0 && (
                  <p className="text-xs text-destructive">
                    ยังไม่มีถังสำหรับน้ำมันชนิดนี้ กรุณาเพิ่มถังในหน้า “สต๊อก”
                    ก่อน
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>มิเตอร์ P ปัจจุบัน (บาทสะสม)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editN.money}
                  onChange={e =>
                    setEditN({ ...editN, money: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>มิเตอร์ L ปัจจุบัน (ลิตรสะสม)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editN.meter}
                  onChange={e =>
                    setEditN({ ...editN, meter: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <p className="text-xs text-amber-600">
                ⚠️ แก้มิเตอร์เฉพาะกรณีค่าในระบบไม่ตรงกับหน้าตู้จ่ายจริง
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={
                !editN?.label || editN.tankId == null || updateNozzle.isPending
              }
              onClick={() =>
                editN &&
                updateNozzle.mutate({
                  id: editN.id,
                  label: editN.label,
                  productId: editN.productId,
                  tankId: editN.tankId!,
                  meter: editN.meter,
                  money: editN.money,
                })
              }
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog ของรางวัล */}
      <Dialog open={!!editR} onOpenChange={o => !o && setEditR(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {editR?.id ? "แก้ไขของรางวัล" : "เพิ่มของรางวัล"}
            </DialogTitle>
          </DialogHeader>
          {editR && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อของรางวัล</Label>
                <Input
                  value={editR.name}
                  onChange={e => setEditR({ ...editR, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>แต้มที่ใช้แลก</Label>
                <Input
                  type="number"
                  value={editR.pointsRequired || ""}
                  onChange={e =>
                    setEditR({
                      ...editR,
                      pointsRequired: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>จำนวนคงเหลือ</Label>
                <Input
                  type="number"
                  value={editR.stock || ""}
                  onChange={e =>
                    setEditR({ ...editR, stock: Number(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={!editR?.name || saveReward.isPending}
              onClick={() =>
                editR && saveReward.mutate({ ...editR, active: true })
              }
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
