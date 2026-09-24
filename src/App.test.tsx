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
});
