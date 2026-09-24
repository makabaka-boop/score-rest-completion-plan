import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { ReportView } from "./components/ReportView";
import { verifyScore } from "./logic/score";

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

describe("休止符补齐清单（界面）", () => {
  it("短声部生成清单与时间轴提示，二者与结论同源；编辑沿用失效规则", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 初始种子两声部对齐：无需补齐
    expect(screen.getByTestId("rest-plan-card")).toHaveTextContent("无需补齐");
    expect(screen.queryByTestId("rest-seg")).toBeNull();

    // 把第 2 个声部（A 声部）第 2 个事件从全音符改为二分 → 该声部结束于 3/2
    const denomSelects = screen.getAllByLabelText("时值分母 2");
    await user.selectOptions(denomSelects[1], "2");

    // 编辑后旧结论（含旧清单）立即失效，禁止下载
    expect(screen.getByTestId("stale-badge")).toBeInTheDocument();
    expect(screen.getByTestId("download-json")).toBeDisabled();

    await user.click(screen.getByTestId("run-check"));
    expect(screen.queryByTestId("stale-badge")).toBeNull();

    // 清单：A 声部第 2 小节补一枚二分休止符（3/2 → 2）
    const card = screen.getByTestId("rest-plan-card");
    expect(card).toHaveTextContent("休止符补齐清单");
    const rows = screen.getAllByTestId("rest-plan-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("A 声部");
    expect(rows[0]).toHaveTextContent("二分");
    expect(rows[0]).toHaveTextContent("3/2");

    // 时间轴提示与清单使用同一份规划结果
    const rests = screen.getAllByTestId("rest-seg");
    expect(rests).toHaveLength(1);
    expect(rests[0]).toHaveAttribute("data-bar", "2");
    expect(rests[0]).toHaveAttribute("data-voice", "1");

    expect(screen.getByTestId("download-json")).toBeEnabled();
  });

  it("存在不可补齐段时报告具体声部及缺口，不给出部分清单", () => {
    // B 声部结束于 191/192，缺口 1/192 无法由允许时值组成；C 声部缺口本来可补
    const r = verifyScore({ numerator: 4, denominator: 4 }, [
      { name: "A", events: [{ id: "a1", bar: 1, denom: 1, dotted: false, triplet: false }] },
      {
        name: "B",
        events: [
          { id: "b1", bar: 1, denom: 1, dotted: false, triplet: true },
          { id: "b2", bar: 1, denom: 4, dotted: false, triplet: false },
          { id: "b3", bar: 1, denom: 32, dotted: true, triplet: false },
          { id: "b4", bar: 1, denom: 32, dotted: false, triplet: false },
        ],
      },
      { name: "C", events: [{ id: "c1", bar: 1, denom: 2, dotted: false, triplet: false }] },
    ]);
    render(<ReportView result={r} stale={false} />);

    const card = screen.getByTestId("rest-plan-card");
    expect(card).toHaveTextContent("无法生成补齐清单");
    expect(card).toHaveTextContent("B");
    expect(card).toHaveTextContent("191/192");
    // 不生成貌似对齐的部分清单
    expect(screen.queryByTestId("rest-plan-table")).toBeNull();
    expect(card).not.toHaveTextContent("休止符补齐清单");
  });
});
