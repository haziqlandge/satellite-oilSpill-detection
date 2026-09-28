/**
 * The closing screen of the technical sequence: the stack clears, "THANK YOU"
 * lands letter by letter, then the team, its ids, its members, and a QR code
 * for the repository. X ends here rather than on the console (the user,
 * 2026-09-27); Z leaves. K shows or hides the names from anywhere.
 *
 * The QR (public/present/repo-qr.svg) was generated once with segno and
 * decoded back to the repository URL with OpenCV before it was committed.
 */
import { createTimeline, stagger, utils } from "animejs";
import { useEffect, useRef } from "react";
import type { BeatBuild } from "../engine";
import { TEAM, THANKS } from "./copy";
import "./thanks.css";

export function ThanksScene({ onBeats, showNames }: { onBeats: (beats: Record<string, BeatBuild>) => void; showNames: boolean }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current!;
    const stack = el.parentElement!.querySelector<HTMLElement>(".pt-stack")!;
    utils.set(el.querySelectorAll(".pt-thanks-letter"), { opacity: 0 });
    onBeats({
      thanks: () =>
        createTimeline()
          .add(stack.querySelectorAll(".pt-tool"), { opacity: 0, scale: 0.85, duration: 450, delay: stagger(12, { from: "center" }), ease: "inQuad" }, 0)
          .add(stack.querySelectorAll(".pt-layer-pill, .pt-connector, .pt-pill"), { opacity: 0, duration: 450, ease: "inQuad" }, 250)
          .set(el, { opacity: 1 }, 700)
          .add(el.querySelectorAll(".pt-thanks-letter"), {
            opacity: [0, 1],
            translateY: [60, 0],
            filter: ["blur(14px)", "blur(0px)"],
            duration: 700,
            delay: stagger(55),
            ease: "outExpo",
          }, 800)
          .add(el.querySelector(".pt-thanks-rule")!, { scaleX: [0, 1], duration: 700, ease: "inOutCubic" }, 1300)
          .add(el.querySelectorAll(".pt-thanks-team > *"), { opacity: [0, 1], translateX: [-24, 0], duration: 520, delay: stagger(110), ease: "outCubic" }, 1600)
          .add(el.querySelector(".pt-thanks-names-wrap")!, { opacity: [0, 1], duration: 300 }, 2100)
          .add(el.querySelectorAll(".pt-thanks-name"), { translateY: [14, 0], duration: 480, delay: stagger(80), ease: "outCubic" }, 2100)
          .add(el.querySelector(".pt-thanks-qr")!, { opacity: [0, 1], scale: [1.3, 1], duration: 750, ease: "outExpo" }, 2300)
          .add(el.querySelectorAll(".pt-thanks-link > *"), { opacity: [0, 1], translateY: [10, 0], duration: 420, delay: stagger(120) }, 2800),
    });
  }, [onBeats]);

  return (
    <div ref={root} className="pt-thanks">
      <div className="pt-thanks-left">
        <h1 className="pt-thanks-title">
          {THANKS.title.split("").map((c, i) => (
            <span key={i} className="pt-thanks-letter">
              {c === " " ? " " : c}
            </span>
          ))}
        </h1>
        <div className="pt-thanks-rule" />
        <div className="pt-thanks-team">
          <div className="pt-thanks-teamname">
            {THANKS.team} <b>{TEAM.name}</b>
          </div>
          <div className="pt-thanks-ids">
            <span>
              {THANKS.teamId} <b>{TEAM.teamId}</b>
            </span>
            <span>
              {THANKS.problemId} <b>{TEAM.problemId}</b>
            </span>
          </div>
        </div>
        <div className={`pt-thanks-names-wrap${showNames ? "" : " pt-names-off"}`}>
          <ul className="pt-thanks-names">
            {TEAM.members.map((m) => (
              <li key={m} className="pt-thanks-name">
                {m}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="pt-thanks-right">
        <div className="pt-thanks-qr">
          <img src="/present/repo-qr.svg" alt={TEAM.repo} />
        </div>
        <div className="pt-thanks-link">
          <span>{THANKS.scan}</span>
          <b>
            {TEAM.repo.replace("https://", "").replace(/\/(?=[^/]*$)/, "/\n")}
          </b>
        </div>
      </div>
    </div>
  );
}
