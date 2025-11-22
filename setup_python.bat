@echo off
echo Setting up Python environment...

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
) else (
    echo Virtual environment already exists.
)


echo Activating virtual environment and installing requirements...
call .venv\Scripts\activate.bat
set HTTP_PROXY="http://127.0.0.1:7890"
python -m pip install --upgrade pip
pip install -r scripts\requirements.txt

echo.
echo Python setup complete!
echo To use this environment in your terminal, run: .venv\Scripts\activate
