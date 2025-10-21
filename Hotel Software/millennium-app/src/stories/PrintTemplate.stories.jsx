import React from "react";
import AdminPrintTemplate from "../admin/AdminPrintTemplate";

export default {
  title: "Admin/PrintTemplate",
  component: AdminPrintTemplate,
};

export const Default = () => <AdminPrintTemplate permissions={["canManageSettings"]} />;
