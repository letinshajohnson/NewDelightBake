import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth, isManager } from "@/context/AuthContext";
import { EmbedCtx, DataTable, useFetch } from "@/components/common";
import Crud from "@/components/Crud";
import Products from "@/pages/Products";
import Sales from "@/pages/Sales";
import Customers from "@/pages/Customers";
import Inventory from "@/pages/Inventory";
import Reports from "@/pages/Reports";
import { BusinessTab, OutletsTab, StaffTab, TablesTab } from "@/pages/Settings";
import { PurchaseOrders, PurchaseReturns } from "@/pages/Purchasing";
import { Adjustments, StockTake, Transfers } from "@/pages/StockManager";
import { CashList, PaymentMethods, Payables, SalesReturns, VoidedSales, BusinessObject } from "@/pages/Finance";

const PERMS = ["pos", "sales.view", "sales.void", "returns", "customers", "catalog", "stock", "purchasing", "finance", "reports", "settings", "users", "shifts", "cost.view"]
  .map((p) => [p, p]);

function Loyalty() {
  const { business } = useAuth();
  const { data } = useFetch("/reports/loyalty");
  const l = business.loyalty || {};
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">One programme for the whole business. Earn 1 point per {l.earn_per / 100} {business.currency}, 1 point = {l.point_value / 100} {business.currency}, points expire after {l.expiry_days} days. Change the rules in Settings → General.</p>
      {data && <DataTable columns={data.columns} rows={data.rows} currency={business.currency} testid="loyalty-table" />}
    </div>
  );
}

const S = (title, sub, tabs) => ({ title, sub, tabs });
export const SECTIONS = {
  catalog: S("Catalog", "Products together with their categories, units, racks and brands.", [
    ["products", "Products", () => <Products />],
    ["categories", "Category", () => <Crud endpoint="categories" title="category" hint="Categories filter products at the register, and their colour carries over to the product cards." fields={[{ key: "name", label: "Name" }, { key: "color", label: "Colour", type: "color" }]} />],
    ["units", "Unit", () => <Crud endpoint="units" title="unit" hint="For example: pcs, kg, box, dozen." fields={[{ key: "name", label: "Unit" }]} />],
    ["racks", "Racks", () => <Crud endpoint="racks" title="rack" hint="Where goods sit in the store — floor, room and shelf name." fields={[{ key: "name", label: "Shelf name" }, { key: "floor", label: "Floor" }, { key: "room", label: "Room" }]} />],
    ["brands", "Brand", () => <Crud endpoint="brands" title="brand" hint="Brands help you filter sales reports by manufacturer — your own and other brands you resell." fields={[{ key: "name", label: "Brand" }, { key: "own", label: "Our own brand", type: "bool" }]} />],
  ]),
  purchasing: S("Purchasing", "Orders to suppliers, goods sent back, and cancelled orders.", [
    ["orders", "Purchase orders", () => <PurchaseOrders />], ["returns", "Purchase returns", () => <PurchaseReturns />], ["cancelled", "Cancelled purchases", () => <PurchaseOrders cancelled />],
  ]),
  sales: S("Sales", "Receipts from the register, goods brought back, and voided receipts.", [
    ["transactions", "Sales transactions", () => <Sales />], ["returns", "Sales returns", () => <SalesReturns />], ["voided", "Voided sales", () => <VoidedSales />],
  ]),
  crm: S("CRM", "Who buys, who supplies, and the loyalty programme that ties them in.", [
    ["customers", "Customers", () => <Customers />],
    ["levels", "Customer levels", () => <Crud endpoint="levels" title="level" hint="Tiered levels are reached automatically by points; flat levels are given by hand." fields={[{ key: "name", label: "Level" }, { key: "kind", label: "Type", type: "select", options: [["tiered", "Tiered (by points)"], ["flat", "Flat (by hand)"]] }, { key: "min_points", label: "Points needed", type: "number" }]} />],
    ["suppliers", "Suppliers", () => <Crud endpoint="suppliers" title="supplier" hint="Goods suppliers and their payment terms." fields={[{ key: "name", label: "Supplier" }, { key: "phone", label: "Phone" }, { key: "terms_days", label: "Payment terms (days)", type: "number" }, { key: "gstin", label: "GSTIN" }]} />],
    ["loyalty", "Loyalty points", () => <Loyalty />],
    ["rewards", "Rewards", () => <Crud endpoint="rewards" title="reward" hint="What customers can redeem their points for." fields={[{ key: "name", label: "Reward" }, { key: "kind", label: "Kind", type: "select", options: [["discount", "Discount"], ["product", "Free product"], ["delivery", "Free delivery"], ["custom", "Custom"]] }, { key: "points", label: "Points cost", type: "number" }, { key: "description", label: "Description" }]} />],
  ]),
  finance: S("Finance", "Money in and out beyond the till, the accounts it sits in, and its categories.", [
    ["cash-in", "Cash in", () => <CashList type="in" />], ["cash-out", "Cash out", () => <CashList type="out" />], ["methods", "Payment methods", () => <PaymentMethods />],
    ["categories", "Categories", () => <Crud endpoint="cash-categories" title="category" hint="Name your own income and expense types; the shift summary groups by them." fields={[{ key: "name", label: "Name" }, { key: "type", label: "Type", type: "select", options: [["in", "Income (cash in)"], ["out", "Expense (cash out)"]] }]} />],
  ]),
  payables: S("Payables & receivables", "Created automatically from credit sales and unpaid purchases.", [["all", "Overview", () => <Payables />]]),
  stock: S("Stock manager", "Balances and every stock change, with the documents behind them.", [
    ["balances", "Stock balances", () => <Inventory view="levels" />], ["ledger", "Movement ledger", () => <Inventory view="ledger" />],
    ["adjustments", "Stock adjustments", () => <Adjustments />], ["stocktake", "Stock take", () => <StockTake />], ["transfers", "Stock transfers", () => <Transfers />],
  ]),
  reports: S("Reports", "Every report in one place.", [["all", "All reports", () => <Reports />]]),
  settings: S("Settings", "How this business records and prints.", [
    ["general", "General settings", () => <BusinessTab />],
    ["prefixes", "Transaction prefixes", () => <BusinessObject field="prefixes" items={[["sale", "Sales"], ["po", "Purchase orders"], ["pr", "Purchase returns"], ["tr", "Stock transfers"], ["st", "Stock takes"]]} note="Till receipts are numbered OUTLET-DEVICE-SEQ so they stay unique offline." />],
    ["notifications", "Notifications", () => <BusinessObject field="notifications" items={[["low_stock", "Low-stock alerts", "bool"], ["shift_close", "Shift closed with a cash difference", "bool"], ["large_void", "Voids and large discounts", "bool"], ["push", "Also send to phones", "bool"]]} note="Preferences are saved; phone push delivery is not connected yet." />],
    ["realtime", "Realtime", () => <BusinessObject field="realtime" items={[["pusher_app_id", "Pusher app ID"], ["pusher_key", "Pusher key"], ["pusher_cluster", "Pusher cluster"]]} note="Kitchen and table screens currently update by polling every few seconds; Pusher is not connected yet." />],
    ["outlets", "Outlets", () => <OutletsTab />],
    ["receipt", "Receipt", () => <BusinessObject field="receipt" items={[["header", "Header line"], ["footer", "Footer"], ["paper", "Paper width (58 or 80 mm)"], ["show_logo", "Show logo", "bool"]]} />],
    ["taxes", "Taxes", () => <Crud endpoint="taxes" title="tax rate" hint="Tax rates; set each product's rate in the product form." fields={[{ key: "name", label: "Name" }, { key: "rate_bps", label: "Rate %", type: "pct" }]} />],
    ["charges", "Extra charges", () => <Crud endpoint="charges" title="charge" hint="Service, packaging or delivery charges. The till applies the service-charge % from General settings." fields={[{ key: "name", label: "Name" }, { key: "type", label: "Type", type: "select", options: [["fixed", "Fixed amount"], ["percent", "Percent"]] }, { key: "value", label: "Amount", type: "money" }, { key: "taxable", label: "Taxable", type: "bool" }]} />],
    ["tables", "Tables & areas", () => <TablesTab />],
  ]),
  users: S("Users", "Who can sign in, and what each of them may do.", [
    ["accounts", "User accounts", () => <StaffTab />],
    ["roles", "Roles & permissions", () => <Crud endpoint="roles" title="role" hint="Each role belongs to your business only. Tick what each role may do." fields={[{ key: "name", label: "Role name" }, { key: "base", label: "Based on", type: "select", options: [["manager", "Manager"], ["cashier", "Cashier"], ["waiter", "Waiter"], ["kitchen", "Kitchen"]] }, { key: "permissions", label: "Permissions", type: "multi", options: PERMS }]} />],
  ]),
};
const STAFF_OK = ["sales", "crm"];

export default function Section() {
  const { section, tab } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const s = SECTIONS[section];
  if (!s || (!isManager(user) && !STAFF_OK.includes(section))) return <Navigate to="/app/sales/transactions" replace />;
  const cur = s.tabs.find((t) => t[0] === tab) || s.tabs[0];
  return (
    <div>
      <div className="mb-6 fade-up">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight" data-testid="page-title">{s.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{s.sub}</p>
      </div>
      {s.tabs.length > 1 && (
        <div className="flex gap-1 border-b mb-6 overflow-x-auto" data-testid="section-tabs">
          {s.tabs.map(([k, label]) => (
            <button key={k} onClick={() => nav(`/app/${section}/${k}`)} data-testid={`tab-${section}-${k}`}
              className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${cur[0] === k ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
      )}
      <EmbedCtx.Provider value={true}><div key={`${section}-${cur[0]}`}>{cur[2]()}</div></EmbedCtx.Provider>
    </div>
  );
}
