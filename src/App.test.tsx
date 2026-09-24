import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("核对台集成：编辑撤销旧结论", () => {
  it("初始结论有效；修改事件后出现失效提示并禁止下载 JSON，重新核对后恢复", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 初始种子数据全部落在小节线上
    expect(screen.queryByTestId("stale-badge")).toBeNull();
    const report = screen.getByTestId("report");
    expect(within(report).getByText(/小节号核对/)).toBeInTheDocument();
    expect(screen.getByTestId("download-json")).toBeEnabled();

    // 把第一个声部第一个事件的标称小节改成 9 -> 旧结论立即失效
    const barInputs = screen.getAllByLabelText(/标称小节号 1/);
    await user.clear(barInputs[0]);
    await user.type(barInputs[0], "9");

    expect(screen.getByTestId("stale-badge")).toBeInTheDocument();
    expect(screen.getByTestId("download-json")).toBeDisabled();

    // 重新核对后，报告刷新为错误结论，失效提示消失
    await user.click(screen.getByTestId("run-check"));
    expect(screen.queryByTestId("stale-badge")).toBeNull();
    const card = screen.getByTestId("first-error-card");
    expect(card).toHaveTextContent("最早错误");
    expect(card).toHaveTextContent("标称小节 9");
  });

  it("修改拍号同样使旧结论失效", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByTestId("stale-badge")).toBeNull();

    await user.selectOptions(screen.getByLabelText("拍号分子"), "3");
    expect(screen.getByTestId("stale-badge")).toBeInTheDocument();

    await user.click(screen.getByTestId("run-check"));
    expect(screen.queryByTestId("stale-badge")).toBeNull();
    // 3/4 下种子（原按 4/4 编写）必然对不上，应报告错误
    expect(screen.getByTestId("first-error-card")).toHaveTextContent("最早错误");
  });

  it("删除事件造成缺口后，重新核对给出休止符补齐清单与时间轴提示", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 初始各声部对齐，无需补齐
    expect(screen.getByTestId("fill-plan-card")).toHaveTextContent("无需补齐");
    expect(screen.queryByTestId("rest-block-1")).toBeNull();

    // 删除 A 声部第 2 个事件（全音符）：A 声部停在第 1 小节线，差 1 个全音符
    const aEditor = screen.getByDisplayValue("A 声部").closest(".voice-editor") as HTMLElement;
    await user.click(within(aEditor).getAllByRole("button", { name: "删" })[1]);

    // 旧结论立即失效，补齐清单也随旧结论一起标记
    expect(screen.getByTestId("stale-badge")).toBeInTheDocument();
    await user.click(screen.getByTestId("run-check"));
    expect(screen.queryByTestId("stale-badge")).toBeNull();

    // 补齐清单：A 声部在小节 2 补 1 枚全音符休止符
    const card = screen.getByTestId("fill-plan-card");
    expect(card).toHaveTextContent("A 声部");
    expect(card).toHaveTextContent("全音符");
    const rows = within(card).getAllByRole("row");
    expect(rows).toHaveLength(2); // 表头 + 1 枚休止符
    expect(rows[1]).toHaveTextContent("2"); // 小节号

    // 时间轴上出现同一份规划结果的休止符提示块
    const blocks = screen.getAllByTestId("rest-block-1");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveAttribute("data-bar", "2");
  });
});
